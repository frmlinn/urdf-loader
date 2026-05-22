import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { URDFLoader } from '../core/URDFLoader';
import { URDFRobot, URDFJoint } from '../core/URDFClasses';

const tempVec2 = new THREE.Vector2();
const emptyRaycast = () => {};

export class URDFViewer extends HTMLElement {
    public scene: THREE.Scene;
    public world: THREE.Object3D;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public controls: OrbitControls;
    public directionalLight: THREE.DirectionalLight;
    public ambientLight: THREE.HemisphereLight;
    public plane: THREE.Mesh;

    public robot: URDFRobot | null = null;
    public loader: URDFLoader;

    private _collisionMaterial: THREE.MeshPhongMaterial;
    private _renderLoopId: number = 0;
    private _dirty: boolean = false;
    private _loadScheduled: boolean = false;
    private _prevload: string = '';
    private _requestId: number = 0;
    private resizeObserver: ResizeObserver;

    static get observedAttributes() {
        return [
            'package', 'urdf', 'up', 'display-shadow', 
            'ambient-color', 'ignore-limits', 'show-collision',
            'auto-redraw', 'no-auto-recenter', 'floor-offset'
        ];
    }

    // --- Atributos Reactivos ---

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

    get angles(): Record<string, number | number[]> { return this.jointValues; }
    set angles(v: Record<string, number | number[]>) { this.jointValues = v; }

    get floorOffset(): number { return parseFloat(this.getAttribute('floor-offset') || '0'); }
    set floorOffset(val: number) { this.setAttribute('floor-offset', val.toString()); }

    // --- Constructor ---

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `
            :host { display: block; width: 100%; height: 100%; position: relative; overflow: hidden; }
            canvas { display: block; width: 100%; height: 100%; outline: none; }
        `;
        this.shadowRoot!.appendChild(style);

        // Scene
        this.scene = new THREE.Scene();
        this.world = new THREE.Object3D();
        this.scene.add(this.world);

        // Lights
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

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setClearColor(0xffffff, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.shadowRoot!.appendChild(this.renderer.domElement);

        // Camera
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

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.rotateSpeed = 2.0;
        this.controls.zoomSpeed = 5;
        this.controls.panSpeed = 2;
        this.controls.enableZoom = true;
        this.controls.enableDamping = false;
        this.controls.maxDistance = 50;
        this.controls.minDistance = 0.25;
        this.controls.addEventListener('change', () => this.recenter());

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

    // --- Ciclo de Vida ---

    connectedCallback() {
        this.resizeObserver.observe(this);
        this.updateSize();
        this._renderLoop();
    }

    disconnectedCallback() {
        this.resizeObserver.disconnect();
        cancelAnimationFrame(this._renderLoopId);
        this.renderer.dispose();
    }

    attributeChangedCallback(attr: string, oldval: string, newval: string) {
        if (oldval === newval) return;

        this._updateCollisionVisibility();
        if (!this.noAutoRecenter) {
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
            case 'floor-offset':
                this.recenter();
                break;
        }
    }

    // --- API Pública ---

    public updateSize() {
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

    public redraw() {
        this._dirty = true;
    }

    public recenter() {
        this._updateEnvironment();
        this.redraw();
    }

    public setJointValue(jointName: string, ...values: (number | null)[]) {
        if (!this.robot || !this.robot.joints[jointName]) return;

        if (this.robot.joints[jointName].setJointValue(...values)) {
            this.redraw();
            this.dispatchEvent(new CustomEvent('angle-change', { bubbles: true, cancelable: true, composed: true, detail: jointName }));
        }
    }

    public setJointValues(values: Record<string, number | (number | null)[]>) {
        for (const name in values) {
            const val = values[name];
            if (Array.isArray(val)) {
                this.setJointValue(name, ...val);
            } else {
                this.setJointValue(name, val);
            }
        }
    }

    // --- Lógica Interna ---

    private _renderLoop = () => {
        if (this.isConnected) {
            if (this._dirty || this.autoRedraw) {
                this.renderer.render(this.scene, this.camera);
                this._dirty = false;
            }
            this.controls.update();
        }
        this._renderLoopId = requestAnimationFrame(this._renderLoop);
    }

    private _updateEnvironment() {
        if (!this.robot) return;

        this.world.updateMatrixWorld();

        const bbox = new THREE.Box3();
        bbox.makeEmpty();
        this.robot.traverse((c) => {
            if ('isURDFVisual' in c) {
                bbox.expandByObject(c as THREE.Object3D);
            }
        });

        if (bbox.isEmpty()) return;

        const center = bbox.getCenter(new THREE.Vector3());
        
        this.controls.target.y = center.y;

        this.plane.position.y = bbox.min.y - 1e-3 - this.floorOffset;

        const dirLight = this.directionalLight;
        dirLight.castShadow = this.displayShadow;

        if (this.displayShadow) {
            const sphere = bbox.getBoundingSphere(new THREE.Sphere());
            const minmax = sphere.radius;
            const cam = dirLight.shadow.camera as THREE.OrthographicCamera;
            
            cam.left = cam.bottom = -minmax;
            cam.right = cam.top = minmax;

            const offset = dirLight.position.clone().sub(dirLight.target.position);
            dirLight.target.position.copy(center);
            dirLight.position.copy(center).add(offset);

            cam.updateProjectionMatrix();
        }
    }

    private _scheduleLoad() {
        const loadStr = `${this.package}|${this.urdf}`;
        if (this._prevload === loadStr) return;
        this._prevload = loadStr;

        if (this._loadScheduled) return;
        this._loadScheduled = true;

        if (this.robot) {
            this.robot.traverse((c) => {
                if ('dispose' in c && typeof c.dispose === 'function') c.dispose();
            });
            this.world.remove(this.robot);
            this.robot = null;
        }

        requestAnimationFrame(() => {
            this._loadUrdf(this.package, this.urdf);
            this._loadScheduled = false;
        });
    }

    private _loadUrdf(pkg: string, urdf: string) {
        this.dispatchEvent(new CustomEvent('urdf-change', { bubbles: true, cancelable: true, composed: true }));

        if (!urdf) return;

        this._requestId++;
        const currentRequestId = this._requestId;

        const updateMaterials = (mesh: THREE.Object3D) => {
            mesh.traverse((c) => {
                if (c instanceof THREE.Mesh) {
                    c.castShadow = true;
                    c.receiveShadow = true;

                    if (c.material) {
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
                        c.material = mats.length === 1 ? mats[0] : mats;
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
        this.loader.packages = parsedPkg;
        this.loader.parseCollision = true;

        manager.onLoad = () => {
            if (this._requestId !== currentRequestId || !this.robot) return;

            updateMaterials(this.robot);
            this._setIgnoreLimits(this.ignoreLimits);
            this._updateCollisionVisibility();

            this.dispatchEvent(new CustomEvent('geometry-loaded', { bubbles: true, cancelable: true, composed: true }));
            this.recenter();
        };

        this.loader.loadAsync(urdf).then((model) => {
            if (this._requestId !== currentRequestId) {
                model.traverse((c) => {
                    if ('dispose' in c && typeof (c as any).dispose === 'function') (c as any).dispose();
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

    private _updateCollisionVisibility() {
        const showCollision = this.showCollision;
        const collisionMaterial = this._collisionMaterial;
        
        if (!this.robot) return;

        const colliders: THREE.Object3D[] = [];
        this.robot.traverse((c) => {
            if ('isURDFCollider' in c) {
                c.visible = showCollision;
                colliders.push(c);
            }
        });

        colliders.forEach(coll => {
            coll.traverse((c) => {
                if (c instanceof THREE.Mesh) {
                    c.raycast = emptyRaycast;
                    c.material = collisionMaterial;
                    c.castShadow = false;
                }
            });
        });
    }

    private _setUp(upAxis: string) {
        let axis = upAxis ? upAxis.toUpperCase() : '+Z';
        const sign = axis.replace(/[^-+]/g, '')[0] || '+';
        const char = axis.replace(/[^XYZ]/gi, '')[0] || 'Z';

        const PI = Math.PI;
        const HALFPI = PI / 2;

        this.world.rotation.set(0, 0, 0);

        if (char === 'X') this.world.rotation.set(0, 0, sign === '+' ? HALFPI : -HALFPI);
        if (char === 'Z') this.world.rotation.set(sign === '+' ? -HALFPI : HALFPI, 0, 0);
        if (char === 'Y') this.world.rotation.set(sign === '+' ? 0 : PI, 0, 0);
        
        this.redraw();
    }

    private _setIgnoreLimits(ignore: boolean, dispatch: boolean = false) {
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