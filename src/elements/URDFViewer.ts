import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { URDFLoader } from '../core/URDFLoader';
import { URDFRobot, URDFJoint, releaseMeshResources, retainResource, releaseResource } from '../core/URDFClasses';

const tempVec2 = new THREE.Vector2();
const emptyRaycast = () => {};

// --- Globally Cached Variables (O(0) Garbage Collection) ---
const _tempBox = new THREE.Box3();
const _globalBox = new THREE.Box3();
const _tempGlobalSphere = new THREE.Sphere();
const _tempVec3 = new THREE.Vector3();
const _tempVec3Scale = new THREE.Vector3();

/**
 * Web Component to render and visualize URDF models within a Three.js scene.
 * Encapsulates the renderer, camera, lights, and orbit controls.
 */
export class URDFViewer extends HTMLElement {
    public scene: THREE.Scene;
    public world: THREE.Object3D;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public controls: OrbitControls;
    public directionalLight: THREE.DirectionalLight;
    public ambientLight: THREE.HemisphereLight;
    /** Transparent plane acting as a shadow catcher floor. */
    public plane: THREE.Mesh;

    /** The loaded URDF robot instance. */
    public robot: URDFRobot | null = null;
    public loader: URDFLoader;

    /** Optional custom hook to bypass default mesh loading behavior. */
    public loadMeshFunc?: (path: string, manager: THREE.LoadingManager) => Promise<THREE.Object3D | null>;

    private _collisionMaterial: THREE.MeshPhongMaterial;
    private _renderLoopId: number = 0;
    private _dirty: boolean = false;
    private _loadScheduled: boolean = false;
    private _prevload: string = '';
    private _requestId: number = 0;
    private resizeObserver: ResizeObserver;

    // --- Shadow System State (Hysteresis and Deferred Updates) ---
    private _shadowsNeedUpdate: boolean = false;
    private _currentShadowCenter: THREE.Vector3 = new THREE.Vector3();
    private _currentShadowRadius: number = 0;

    /** Registers attributes to trigger the `attributeChangedCallback`. */
    static get observedAttributes(): string[] {
        return [
            'package', 'urdf', 'up', 'display-shadow', 
            'ambient-color', 'ignore-limits', 'show-collision',
            'auto-redraw', 'no-auto-recenter'
        ];
    }

    // --- Reactive Attributes ---

    get package(): string { return this.getAttribute('package') || ''; }
    set package(val: string) { this.setAttribute('package', val); }

    get urdf(): string { return this.getAttribute('urdf') || ''; }
    set urdf(val: string) { this.setAttribute('urdf', val); }

    get up(): string { return this.getAttribute('up') || '+Z'; }
    set up(val: string) { this.setAttribute('up', val); }

    get ambientColor(): string { return this.getAttribute('ambient-color') || '#8ea0a8'; }
    set ambientColor(val: string) { val ? this.setAttribute('ambient-color', val) : this.removeAttribute('ambient-color'); }

    get displayShadow(): boolean { return this.hasAttribute('display-shadow'); }
    set displayShadow(val: boolean) { val ? this.setAttribute('display-shadow', '') : this.removeAttribute('display-shadow'); }

    get ignoreLimits(): boolean { return this.hasAttribute('ignore-limits'); }
    set ignoreLimits(val: boolean) { val ? this.setAttribute('ignore-limits', '') : this.removeAttribute('ignore-limits'); }

    get showCollision(): boolean { return this.hasAttribute('show-collision'); }
    set showCollision(val: boolean) { val ? this.setAttribute('show-collision', '') : this.removeAttribute('show-collision'); }

    get autoRedraw(): boolean { return this.hasAttribute('auto-redraw'); }
    set autoRedraw(val: boolean) { val ? this.setAttribute('auto-redraw', '') : this.removeAttribute('auto-redraw'); }

    get noAutoRecenter(): boolean { return this.hasAttribute('no-auto-recenter'); }
    set noAutoRecenter(val: boolean) { val ? this.setAttribute('no-auto-recenter', '') : this.removeAttribute('no-auto-recenter'); }

    /** Returns a dictionary of current joint values. Supports both scalar and vector states. */
    get jointValues(): Record<string, number | number[]> {
        const values: Record<string, number | number[]> = {};
        if (this.robot) {
            for (const name in this.robot.joints) {
                const joint = this.robot.joints[name];
                values[name] = joint.jointValue.length === 1 ? joint.angle : [...joint.jointValue];
            }
        }
        return values;
    }
    set jointValues(val: Record<string, number | number[]>) { this.setJointValues(val); }

    /** Alias for jointValues. */
    get angles(): Record<string, number | number[]> { return this.jointValues; }
    set angles(v: Record<string, number | number[]>) { this.jointValues = v; }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `
            :host { display: block; width: 100%; height: 100%; position: relative; overflow: hidden; }
            canvas { display: block; width: 100%; height: 100%; outline: none; }
        `;
        this.shadowRoot!.appendChild(style);

        // Scene configuration
        this.scene = new THREE.Scene();
        this.world = new THREE.Object3D();
        this.scene.add(this.world);

        // Lights configuration
        this.ambientLight = new THREE.HemisphereLight(this.ambientColor, '#000000', 0.5);
        this.ambientLight.groundColor.lerp(this.ambientLight.color, 0.5);
        this.ambientLight.position.set(0, 1, 0);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, Math.PI);
        this.directionalLight.position.set(4, 10, 1);
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.directionalLight.shadow.normalBias = 0.001;
        this.directionalLight.castShadow = true;
        this.scene.add(this.directionalLight);
        this.scene.add(this.directionalLight.target);

        // Renderer configuration
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setClearColor(0xffffff, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.shadowRoot!.appendChild(this.renderer.domElement);

        // Camera configuration
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        this.camera.position.set(2, 2, 2);

        // Base Plane (Shadow Catcher)
        this.plane = new THREE.Mesh(
            new THREE.PlaneGeometry(40, 40),
            new THREE.ShadowMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.25 })
        );
        this.plane.rotation.x = -Math.PI / 2;
        this.plane.position.y = -0.5;
        this.plane.receiveShadow = true;
        this.plane.scale.set(10, 10, 10);
        this.scene.add(this.plane);

        // OrbitControls configuration
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.rotateSpeed = 2.0;
        this.controls.zoomSpeed = 5;
        this.controls.panSpeed = 2;
        this.controls.enableZoom = true;
        this.controls.enableDamping = false;
        this.controls.maxDistance = 50;
        this.controls.minDistance = 0.25;
        // True O(1) decoupling, forces a redraw flag when view changes
        this.controls.addEventListener('change', () => this.redraw());

        // Collider Material Setup
        this._collisionMaterial = new THREE.MeshPhongMaterial({
            transparent: true,
            opacity: 0.35,
            shininess: 2.5,
            premultipliedAlpha: true,
            color: 0xffbe38,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });

        this.loader = new URDFLoader();
        this._setUp(this.up);
        this.resizeObserver = new ResizeObserver(() => this.updateSize());
    }

    // --- Web Component Lifecycle ---

    connectedCallback(): void {
        this.resizeObserver.observe(this);
        this.updateSize();
        this._renderLoop();
    }

    disconnectedCallback(): void {
        this.resizeObserver.disconnect();
        cancelAnimationFrame(this._renderLoopId);
        if (this.robot) {
            this.robot.traverse((c) => {
                if (c instanceof THREE.Mesh) releaseMeshResources(c);
            });
            this.robot = null;
        }
        this.renderer.dispose();
    }

    attributeChangedCallback(attr: string, oldval: string, newval: string): void {
        if (oldval === newval) return;

        this._updateCollisionVisibility();
        
        if (!this.noAutoRecenter && attr !== 'display-shadow') {
            this.recenter();
        }

        switch (attr) {
            case 'package':
            case 'urdf':
                this._scheduleLoad();
                break;
            case 'up':
                this._setUp(this.up);
                break;
            case 'ambient-color':
                this.ambientLight.color.set(this.ambientColor);
                this.ambientLight.groundColor.set('#000000').lerp(this.ambientLight.color, 0.5);
                break;
            case 'ignore-limits':
                this._setIgnoreLimits(this.ignoreLimits, true);
                break;
            case 'display-shadow':
                this.directionalLight.castShadow = this.displayShadow;
                if (this.displayShadow) this._shadowsNeedUpdate = true;
                this.redraw();
                break;
        }
    }

    // --- Public API ---

    /** Synchronizes the WebGL renderer size with the component's DOM boundaries. */
    public updateSize(): void {
        const w = this.clientWidth;
        const h = this.clientHeight;
        if (w === 0 || h === 0) return;

        const currSize = this.renderer.getSize(tempVec2);
        if (currSize.width !== w || currSize.height !== h) {
            this.recenter();
        }

        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(w, h, false);

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** Flags the scene to be re-rendered on the next animation frame. */
    public redraw(): void {
        this._dirty = true;
    }

    /** Centers the camera controls and shadow frustum onto the robot's current bounding sphere. */
    public recenter(): void {
        if (!this.robot) return;
        this.world.updateMatrixWorld(true);

        // Force ground plane and shadow update bypassing hysteresis
        this._updateShadowBounds(true);

        if (!_tempGlobalSphere.isEmpty()) {
            this.controls.target.copy(_tempGlobalSphere.center);
        }
        this.redraw();
    }

    /**
     * Updates the angle/position of a specific joint.
     * @param jointName - The string ID of the target joint.
     * @param values - Joint values (e.g., angle in radians).
     */
    public setJointValue(jointName: string, ...values: (number | null)[]): void {
        if (!this.robot || !this.robot.joints[jointName]) return;

        // Reactive Injection (Dirty Flag)
        if (this.robot.joints[jointName].setJointValue(...values)) {
            this._shadowsNeedUpdate = true; // Deferred Update
            this.redraw();
            this.dispatchEvent(new CustomEvent('angle-change', { bubbles: true, cancelable: true, composed: true, detail: jointName }));
        }
    }

    /**
     * Updates multiple joints simultaneously.
     * @param values - A mapping of joint names to their target numeric state.
     */
    public setJointValues(values: Record<string, number | (number | null)[]>): void {
        let didChange = false;
        for (const name in values) {
            const val = values[name];
            if (Array.isArray(val)) {
                if (this.robot?.joints[name]?.setJointValue(...val)) didChange = true;
            } else {
                if (this.robot?.joints[name]?.setJointValue(val)) didChange = true;
            }
        }
        if (didChange) {
            this._shadowsNeedUpdate = true;
            this.redraw();
        }
    }

    // --- Internal Logic ---

    /** Centralized requestAnimationFrame loop. Uses deferred evaluations. */
    private _renderLoop = () => {
        if (this.isConnected) {
            // Evaluate deferred kinematics once right before rendering
            if (this._shadowsNeedUpdate) {
                this.world.updateMatrixWorld(true);
                this._updateShadowBounds(); // Updates plane and shadow camera if applicable
                this._shadowsNeedUpdate = false;
            }

            if (this._dirty || this.autoRedraw) {
                this.renderer.render(this.scene, this.camera);
                this._dirty = false;
            }
            this.controls.update();
        }
        this._renderLoopId = requestAnimationFrame(this._renderLoop);
    }

    /**
     * Hybrid AABB heuristic (O(M) complexity) to wrap the scene bounds.
     * Guarantees meshes are tightly constrained at the bottom (minY).
     * * @param targetSphere - Output sphere to store bounding geometry.
     * @returns The lowest Y coordinate in world space.
     */
    private _calculateSceneBounds(targetSphere: THREE.Sphere): number {
        _globalBox.makeEmpty();
        let minY = Infinity;

        if (!this.robot || this.robot.flatVisualMeshes.length === 0) {
            targetSphere.makeEmpty();
            return 0;
        }

        for (let i = 0; i < this.robot.flatVisualMeshes.length; i++) {
            const mesh = this.robot.flatVisualMeshes[i];
            
            // 1. Box calculation (Inflates global AABB)
            const localBox = mesh.geometry.boundingBox!; 
            _tempBox.copy(localBox).applyMatrix4(mesh.matrixWorld);
            _globalBox.union(_tempBox);
            const boxMinY = _tempBox.min.y;

            // 2. Sphere calculation (Extracts globally scaled radius)
            const localSphere = mesh.geometry.boundingSphere!;
            _tempVec3.copy(localSphere.center).applyMatrix4(mesh.matrixWorld);
            
            _tempVec3Scale.setFromMatrixScale(mesh.matrixWorld);
            const maxScale = Math.max(Math.abs(_tempVec3Scale.x), Math.abs(_tempVec3Scale.y), Math.abs(_tempVec3Scale.z));
            const sphereMinY = _tempVec3.y - (localSphere.radius * maxScale);

            // 3. Hybrid Heuristic: A real mesh can NEVER be lower than 
            // the min of its Box NOR the min of its Bounding Sphere.
            // Select the tightest (highest) lower bound.
            const tightMinY = Math.max(boxMinY, sphereMinY);

            if (tightMinY < minY) minY = tightMinY;
        }

        // Extract perfect sphere for the camera's wide frustum
        _globalBox.getBoundingSphere(targetSphere);

        return minY === Infinity ? 0 : minY;
    }

    /** Computes dynamic shadow camera projections and shadow plane offsets. */
    private _updateShadowBounds(force: boolean = false): void {
        if (!this.robot) return;

        const currentMinY = this._calculateSceneBounds(_tempGlobalSphere);
        if (_tempGlobalSphere.isEmpty()) return;

        // Synchronize floor plane in real-time, decoupled from shadow hysteresis.
        this.plane.position.y = currentMinY - 1e-3;

        // Skip shadow camera updates if disabled
        if (!this.displayShadow) return;

        // --- Shadow Hysteresis ---
        const center = _tempGlobalSphere.center;
        const radius = _tempGlobalSphere.radius;
        const targetRadius = radius * 1.15; // 15% slack
        
        if (!force && this._currentShadowRadius > 0) {
            const dist = this._currentShadowCenter.distanceTo(center);
            // Ignore if the new bounds comfortably fit into our current frustum
            if (dist + radius < this._currentShadowRadius) return; 
        }

        // Update shadow cache
        this._currentShadowCenter.copy(center);
        this._currentShadowRadius = targetRadius;

        const dirLight = this.directionalLight;
        const cam = dirLight.shadow.camera as THREE.OrthographicCamera;
        
        cam.left = cam.bottom = -targetRadius;
        cam.right = cam.top = targetRadius;

        const offset = dirLight.position.clone().sub(dirLight.target.position);
        dirLight.target.position.copy(center);
        dirLight.position.copy(center).add(offset);

        const distance = dirLight.position.distanceTo(center);
        cam.near = Math.max(0.1, distance - targetRadius);
        cam.far = distance + targetRadius + 5.0; 

        cam.updateProjectionMatrix();
    }

    /** Debounces load requests to prevent race conditions during rapid attribute updates. */
    private _scheduleLoad(): void {
        const loadStr = `${this.package}|${this.urdf}`;
        if (this._prevload === loadStr) return;
        this._prevload = loadStr;

        if (this._loadScheduled) return;
        this._loadScheduled = true;

        if (this.robot) {
            this.robot.traverse((c) => {
                if (c instanceof THREE.Mesh) releaseMeshResources(c);
            });
            this.world.remove(this.robot);
            this.robot = null;
        }

        requestAnimationFrame(() => {
            this._loadUrdf(this.package, this.urdf);
            this._loadScheduled = false;
        });
    }

    /** Internally fetches and processes the raw URDF descriptor. */
    private _loadUrdf(pkg: string, urdf: string): void {
        this.dispatchEvent(new CustomEvent('urdf-change', { bubbles: true, cancelable: true, composed: true }));

        if (!urdf) return;

        this._requestId++;
        const currentRequestId = this._requestId;

        const updateMaterials = (robot: URDFRobot) => {
            robot.flatVisualMeshes.forEach(c => {
                c.castShadow = true;
                c.receiveShadow = true;

                if (c.material) {
                    const oldMaterial = c.material;
                    const mats = (Array.isArray(c.material) ? c.material : [c.material]).map(m => {
                        let mat = m as THREE.Material;
                        if (mat instanceof THREE.MeshBasicMaterial) {
                            mat = new THREE.MeshPhongMaterial();
                            THREE.Material.prototype.copy.call(mat, m);
                        }
                        if ((mat as any).map) {
                            (mat as any).map.colorSpace = THREE.SRGBColorSpace;
                        }
                        return mat;
                    });
                    
                    const newMaterial = mats.length === 1 ? mats[0] : mats;
                    
                    if (oldMaterial !== newMaterial) {
                        const oldMatsArray = Array.isArray(oldMaterial) ? oldMaterial : [oldMaterial];
                        oldMatsArray.forEach(releaseResource);
                        
                        const newMatsArray = Array.isArray(newMaterial) ? newMaterial : [newMaterial];
                        newMatsArray.forEach(retainResource);
                        
                        c.material = newMaterial;
                    }
                }
            });
        };

        let parsedPkg: string | Record<string, string> = pkg;
        if (typeof pkg === 'string' && pkg.includes(':') && pkg.split(':')[1].substring(0, 2) !== '//') {
            parsedPkg = pkg.split(',').reduce((map: Record<string, string>, value: string) => {
                const split = value.split(/:/).filter(x => !!x);
                if (split.length >= 2) {
                    const pkgName = split.shift()!.trim();
                    const pkgPath = split.join(':').trim();
                    map[pkgName] = pkgPath;
                }
                return map;
            }, {});
        }

        const manager = new THREE.LoadingManager();
        this.loader = new URDFLoader(manager);
        if (this.loadMeshFunc) {
            this.loader.loadMeshFunc = this.loadMeshFunc;
        }
        this.loader.packages = parsedPkg;
        this.loader.parseCollision = true;

        manager.onLoad = () => {
            if (this._requestId !== currentRequestId || !this.robot) return;

            this.robot.updateMeshCaches();

            updateMaterials(this.robot);
            this._setIgnoreLimits(this.ignoreLimits);
            this._updateCollisionVisibility();

            this.dispatchEvent(new CustomEvent('geometry-loaded', { bubbles: true, cancelable: true, composed: true }));
            this.recenter();
        };

        this.loader.loadAsync(urdf).then((model) => {
            if (this._requestId !== currentRequestId) {
                model.traverse((c) => {
                    if (c instanceof THREE.Mesh) releaseMeshResources(c);
                });
                return;
            }

            this.robot = model;
            this.world.add(this.robot);
            this.dispatchEvent(new CustomEvent('urdf-processed', { bubbles: true, cancelable: true, composed: true }));
        }).catch(err => {
            console.error('URDFViewer: Failed to load URDF.', err);
            this.dispatchEvent(new CustomEvent('urdf-error', { bubbles: true, cancelable: true, composed: true, detail: err }));
        });
    }

    /** Toggles raycast targets and mesh visibility based on `showCollision` flag. */
    private _updateCollisionVisibility(): void {
        if (!this.robot) return;

        const showCollision = this.showCollision;
        const collisionMaterial = this._collisionMaterial;
        const hasColliders = Object.keys(this.robot.colliders).length > 0;

        this.robot.flatVisualMeshes.forEach(mesh => {
            if (hasColliders) {
                mesh.raycast = emptyRaycast;
            } else {
                delete (mesh as any).raycast;
            }
        });

        this.robot.flatColliderMeshes.forEach(mesh => {
            delete (mesh as any).raycast; 
            mesh.material = collisionMaterial;
            mesh.castShadow = false;

            let curr = mesh.parent;
            while (curr && !('isURDFCollider' in curr)) {
                curr = curr.parent;
            }
            if (curr) {
                curr.visible = showCollision;
            }
        });
    }

    /** Applies base Euler rotations to match URDF environment conventions. */
    private _setUp(upAxis: string): void {
        let axis = upAxis ? upAxis.toUpperCase() : '+Z';
        const sign = axis.replace(/[^-+]/g, '')[0] || '+';
        const char = axis.replace(/[^XYZ]/gi, '')[0] || 'Z';

        const PI = Math.PI;
        const HALFPI = PI / 2;

        this.world.rotation.set(0, 0, 0);

        if (char === 'X') this.world.rotation.set(0, 0, sign === '+' ? HALFPI : -HALFPI);
        if (char === 'Z') this.world.rotation.set(sign === '+' ? -HALFPI : HALFPI, 0, 0);
        if (char === 'Y') this.world.rotation.set(sign === '+' ? 0 : PI, 0, 0);
        
        this.recenter();
    }

    /** Overrides bounds and limits locally and triggers updates across all joints. */
    private _setIgnoreLimits(ignore: boolean, dispatch: boolean = false): void {
        if (this.robot) {
            Object.values(this.robot.joints).forEach((joint: URDFJoint) => {
                joint.ignoreLimits = ignore;
                joint.setJointValue(...joint.jointValue);
            });
        }

        if (dispatch) {
            this.dispatchEvent(new CustomEvent('ignore-limits-change', { bubbles: true, cancelable: true, composed: true }));
        }
    }
}

customElements.define('urdf-viewer', URDFViewer);