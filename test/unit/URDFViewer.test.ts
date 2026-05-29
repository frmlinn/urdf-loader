import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { URDFLoader } from '../../src/core/URDFLoader';
import { URDFRobot, URDFJoint, URDFCollider } from '../../src/core/URDFClasses';
import { URDFViewer } from '../../src/elements/URDFViewer';
import '../../src/elements/URDFViewer';

// ==========================================
// GLOBAL MOCKS & UTILITIES
// ==========================================

/** Mock ResizeObserver as jsdom lacks native support. */
global.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
} as unknown as typeof ResizeObserver;

/** Mock THREE.WebGLRenderer to bypass WebGL context requirements in jsdom. */
vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three')>();
    class MockWebGLRenderer {
        domElement = document.createElement('canvas');
        shadowMap = { enabled: false, type: 0 };
        outputColorSpace = '';
        setClearColor = vi.fn();
        getSize = vi.fn().mockReturnValue(new actual.Vector2(0, 0));
        setPixelRatio = vi.fn();
        setSize = vi.fn();
        render = vi.fn();
        compile = vi.fn();
        dispose = vi.fn();
    }
    return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

/** * Flushes the microtask queue to process pending Promises safely.
 */
const flushPromises = () => new Promise(resolve => process.nextTick(resolve));

/**
 * Triggers the debounced requestAnimationFrame to process the URL change
 * and waits for the internal promises of URDFLoader to resolve.
 */
const waitForLoad = async () => {
    vi.advanceTimersByTime(16); // Advance 1 frame (16ms) to trigger RAF
    await flushPromises();      // Resolve loadAsync promises
};

// ==========================================
// TEST SUITE
// ==========================================

/**
 * Interface exposing private internal properties of URDFViewer for testing purposes.
 */
interface ViewerPrivates {
    _collisionMaterial: THREE.Material;
    _shadowsNeedUpdate: boolean;
    _setIgnoreLimits: (ignore: boolean, dispatch?: boolean) => void;
    _updateShadowBounds: (force?: boolean) => void;
    _renderLoop: () => void;
    _dirty: boolean;
}

/** Helper to safely access private properties without triggering TypeScript's `never` overlap */
const getPrivates = (v: URDFViewer) => v as unknown as ViewerPrivates;

describe('URDFViewer Web Component', () => {
    let viewer: URDFViewer;

    beforeEach(() => {
        // Intercept RAF to control debounced render and loading cycles natively via Vitest
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
        
        document.body.innerHTML = '';
        viewer = document.createElement('urdf-viewer') as URDFViewer;
        document.body.appendChild(viewer);

        Object.defineProperty(viewer, 'clientWidth', { value: 800, configurable: true });
        Object.defineProperty(viewer, 'clientHeight', { value: 600, configurable: true });
    });

    afterEach(() => {
        // Disconnect safely to prevent "zombie" render loops from starving the Event Loop
        if (viewer && viewer.isConnected) {
            viewer.remove();
        }

        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('Initialization and Base Structure', () => {
        it('should register in customElements and instantiate the Shadow DOM', () => {
            expect(customElements.get('urdf-viewer')).toBeDefined();
            expect(viewer.shadowRoot).not.toBeNull();
        });

        it('should initialize default scene, camera, and lights', () => {
            expect(viewer.scene).toBeInstanceOf(THREE.Scene);
            expect(viewer.camera).toBeInstanceOf(THREE.PerspectiveCamera);
            expect(viewer.ambientLight).toBeInstanceOf(THREE.HemisphereLight);
            expect(viewer.directionalLight).toBeInstanceOf(THREE.DirectionalLight);
            expect(viewer.plane).toBeInstanceOf(THREE.Mesh); 
        });

        it('should remove boolean attributes when their setters receive false', () => {
            viewer.displayShadow = true;
            viewer.ignoreLimits = true;
            viewer.showCollision = true;
            viewer.autoRedraw = true;
            viewer.noAutoRecenter = true;
            
            viewer.displayShadow = false;
            viewer.ignoreLimits = false;
            viewer.showCollision = false;
            viewer.autoRedraw = false;
            viewer.noAutoRecenter = false;

            expect(viewer.hasAttribute('display-shadow')).toBe(false);
            expect(viewer.hasAttribute('show-collision')).toBe(false);
        });

        it('should release mesh resources when disconnectedCallback is executed', () => {
            const mockRobot = new URDFRobot();
            const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
            
            mesh.geometry.userData = { refCount: 1 };
            mesh.material.userData = { refCount: 1 };

            mockRobot.add(mesh);
            viewer.robot = mockRobot;

            const disposeSpy = vi.spyOn(mesh.geometry, 'dispose'); 

            viewer.disconnectedCallback();

            expect(viewer.robot).toBeNull();
            expect(disposeSpy).toHaveBeenCalled();
        });
    });

    describe('Reactive Attributes (attributeChangedCallback)', () => {
        it('should update ambient color when "ambient-color" attribute changes', () => {
            viewer.setAttribute('ambient-color', '#ff0000');
            expect(viewer.ambientLight.color.getHexString()).toBe('ff0000');
        });

        it('should update world rotation when "up" axis changes', () => {
            viewer.setAttribute('up', '+Y');
            expect(viewer.world.rotation.x).toBe(0);

            viewer.setAttribute('up', '+X');
            expect(viewer.world.rotation.z).toBeCloseTo(Math.PI / 2);
        });

        it('should correctly interpret multiple "up" axis combinations', () => {
            viewer.setAttribute('up', '-Z');
            expect(viewer.world.rotation.x).toBeCloseTo(Math.PI / 2);

            viewer.setAttribute('up', '-Y');
            expect(viewer.world.rotation.x).toBeCloseTo(Math.PI);

            viewer.setAttribute('up', '-X');
            expect(viewer.world.rotation.z).toBeCloseTo(-Math.PI / 2);
        });

        it('should toggle shadow projection via "display-shadow" attribute', () => {
            viewer.setAttribute('display-shadow', '');
            expect(viewer.directionalLight.castShadow).toBe(true);
            
            expect(getPrivates(viewer)._shadowsNeedUpdate).toBe(true);

            viewer.removeAttribute('display-shadow');
            expect(viewer.directionalLight.castShadow).toBe(false);
        });

        it('should propagate "ignore-limits" flag to all joints if a robot is loaded', () => {
            const mockRobot = new URDFRobot();
            const joint = new URDFJoint();
            joint.name = 'TestJoint';
            mockRobot.joints['TestJoint'] = joint;
            viewer.robot = mockRobot;

            viewer.setAttribute('ignore-limits', '');
            expect(joint.ignoreLimits).toBe(true);

            viewer.removeAttribute('ignore-limits');
            expect(joint.ignoreLimits).toBe(false);
        });

        it('should toggle visibility and material of collisions (showCollision)', () => {
            const mockRobot = new URDFRobot();
            const colliderMesh = new THREE.Mesh();
            Object.defineProperty(colliderMesh, 'isURDFCollider', { value: true });
            
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            const visualMesh = new THREE.Mesh(geometry);
            
            mockRobot.flatColliderMeshes = [colliderMesh];
            mockRobot.flatVisualMeshes = [visualMesh];
            mockRobot.colliders['TestCol'] = colliderMesh as unknown as URDFCollider;
            viewer.robot = mockRobot;

            viewer.setAttribute('show-collision', '');

            expect(colliderMesh.material).toBe(getPrivates(viewer)._collisionMaterial);
            expect((visualMesh as unknown as { raycast: () => void }).raycast).toBeDefined();

            viewer.removeAttribute('show-collision');
        });
    });

    describe('Resizing and Rendering', () => {
        it('should update camera and WebGLRenderer when size changes (updateSize)', () => {
            const setSizeSpy = vi.spyOn(viewer.renderer, 'setSize');
            const updateProjectionSpy = vi.spyOn(viewer.camera, 'updateProjectionMatrix');

            viewer.updateSize();

            expect(setSizeSpy).toHaveBeenCalledWith(800, 600, false);
            expect(viewer.camera.aspect).toBe(800 / 600);
            expect(updateProjectionSpy).toHaveBeenCalled();
        });

        it('should flag the scene as dirty when calling redraw()', () => {
            getPrivates(viewer)._dirty = false;
            viewer.redraw();
            expect(getPrivates(viewer)._dirty).toBe(true);
        });

        it('should calculate scene bounds and update shadow camera dynamically', () => {
            const mockRobot = new URDFRobot();
            const geometry = new THREE.BoxGeometry(2, 2, 2);
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            
            const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
            mesh.updateMatrixWorld(true);
            mockRobot.flatVisualMeshes = [mesh];
            viewer.robot = mockRobot;
            
            viewer.setAttribute('display-shadow', '');

            viewer.recenter();

            const cam = viewer.directionalLight.shadow.camera as THREE.OrthographicCamera;
            expect(cam.left).toBeLessThan(0);
            expect(cam.right).toBeGreaterThan(0);
            expect(viewer.plane.position.y).toBeLessThanOrEqual(mesh.geometry.boundingBox!.min.y);
        });
    });

    describe('URDF Load Lifecycle', () => {
        it('should debounce loading and dispatch events when "urdf" attribute is set', async () => {
            const mockRobot = new URDFRobot();
            mockRobot.traverse = vi.fn(); 
            
            const loadAsyncSpy = vi.spyOn(URDFLoader.prototype, 'loadAsync').mockResolvedValue(mockRobot);
            const eventSpy = vi.fn();
            viewer.addEventListener('urdf-change', eventSpy);
            viewer.addEventListener('urdf-processed', eventSpy);

            viewer.setAttribute('package', '/mock-pkg');
            viewer.setAttribute('urdf', 'robot.urdf');

            await waitForLoad();

            expect(loadAsyncSpy).toHaveBeenCalledWith('robot.urdf');
            expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'urdf-change' }));
            expect(viewer.robot).toBe(mockRobot);
            expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'urdf-processed' }));
            
            loadAsyncSpy.mockRestore();
        });

        it('should parse a package dictionary based on a comma and colon string', async () => {
            const loadAsyncSpy = vi.spyOn(URDFLoader.prototype, 'loadAsync').mockResolvedValue(new URDFRobot());

            viewer.package = 'pkgA: /route/A, pkgB: /route/B';
            viewer.urdf = 'robot.urdf'; 
            
            await waitForLoad();
            
            const loaderPkgs = viewer.loader.packages as Record<string, string>;
            expect(loaderPkgs['pkgA']).toBe('/route/A');
            expect(loaderPkgs['pkgB']).toBe('/route/B');

            loadAsyncSpy.mockRestore();
        });

        it('should abort manager.onLoad safely if the robot is null', async () => {
            const loadSpy = vi.spyOn(URDFLoader.prototype, 'loadAsync').mockReturnValue(new Promise(() => {}));

            viewer.urdf = 'dummy.urdf';
            await waitForLoad();
            
            viewer.robot = null; 
            
            const renderCompileSpy = vi.spyOn(viewer.renderer, 'compile');
            
            if (viewer.loader.manager.onLoad) {
                viewer.loader.manager.onLoad();
            }
            
            expect(renderCompileSpy).not.toHaveBeenCalled();

            loadSpy.mockRestore();
        });
    });

    describe('Public API and Joint Manipulation', () => {
        let mockRobot: URDFRobot;
        let jointA: URDFJoint;

        beforeEach(() => {
            mockRobot = new URDFRobot();
            jointA = new URDFJoint();
            jointA.name = 'JointA';
            
            jointA.jointType = 'continuous'; 
            mockRobot.joints['JointA'] = jointA;
            viewer.robot = mockRobot;
        });

        it('should update a joint and redraw via setJointValue', () => {
            const redrawSpy = vi.spyOn(viewer, 'redraw');
            const eventSpy = vi.fn();
            viewer.addEventListener('angle-change', eventSpy);

            viewer.setJointValue('JointA', Math.PI);

            expect(jointA.angle).toBe(Math.PI);
            expect(redrawSpy).toHaveBeenCalled();
            expect(getPrivates(viewer)._shadowsNeedUpdate).toBe(true);
            expect(eventSpy).toHaveBeenCalled();
        });

        it('should ignore setJointValue calls for non-existent joints', () => {
            const redrawSpy = vi.spyOn(viewer, 'redraw');
            viewer.setJointValue('NonExistentJoint', 1.0);
            expect(redrawSpy).not.toHaveBeenCalled();
        });

        it('should retrieve and set multiple values via jointValues / angles property', () => {
            viewer.jointValues = { 'JointA': Math.PI / 2 };
            expect(jointA.angle).toBe(Math.PI / 2);

            const values = viewer.jointValues; 
            expect(values['JointA']).toBe(Math.PI / 2);
        });

        it('should apply jointValues via arrays if the joint supports it (e.g., Planar)', () => {
            const planarJoint = new URDFJoint();
            planarJoint.name = 'PlanarJ';
            planarJoint.jointType = 'planar';
            mockRobot.joints['PlanarJ'] = planarJoint;

            viewer.setJointValues({ 'PlanarJ': [1, 2, 3] });
            
            expect(planarJoint.jointValue).toEqual([1, 2, 3]);
        });

        it('should dispatch ignore-limits-change event when modified manually', () => {
            const eventSpy = vi.fn();
            viewer.addEventListener('ignore-limits-change', eventSpy);
            
            getPrivates(viewer)._setIgnoreLimits(true, true);
            
            expect(eventSpy).toHaveBeenCalled();
        });
    });

    describe('Surgical Coverage and Edge Cases', () => {
        it('should handle boolean property setters when they receive false', () => {
            viewer.ambientColor = 'blue';
            viewer.ambientColor = ''; 
            expect(viewer.hasAttribute('ambient-color')).toBe(false);

            viewer.displayShadow = true;
            viewer.displayShadow = false; 
            expect(viewer.hasAttribute('display-shadow')).toBe(false);
        });

        it('should use the "angles" alias to interact with jointValues', () => {
            const mockRobot = new URDFRobot();
            const joint = new URDFJoint();
            joint.name = 'JointAlias';
            joint.jointType = 'continuous'; 
            mockRobot.joints['JointAlias'] = joint;
            viewer.robot = mockRobot;

            viewer.angles = { 'JointAlias': 1.5 };
            expect(viewer.angles['JointAlias']).toBe(1.5);
        });

        it('should process arrays in setJointValues and trigger didChange', () => {
            const mockRobot = new URDFRobot();
            const planarJoint = new URDFJoint();
            planarJoint.name = 'PlanarJ';
            planarJoint.jointType = 'planar';
            mockRobot.joints['PlanarJ'] = planarJoint;
            viewer.robot = mockRobot;

            const redrawSpy = vi.spyOn(viewer, 'redraw');
            
            viewer.setJointValues({ 'PlanarJ': [1.0, 2.0, 0.5] });
            
            expect(redrawSpy).toHaveBeenCalled();
            expect(getPrivates(viewer)._shadowsNeedUpdate).toBe(true);
        });

        it('should correctly apply SRGBColorSpace to texture maps on supported materials', async () => {
            const mockRobot = new URDFRobot();
            const mesh = new THREE.Mesh(new THREE.BufferGeometry());
            const mockTexture = new THREE.Texture();
            const matWithTexture = new THREE.MeshPhongMaterial({ map: mockTexture });
            const matWithoutTexture = new THREE.MeshBasicMaterial();
            
            mesh.material = [matWithTexture, matWithoutTexture];
            
            mockRobot.add(mesh); 
            mockRobot.flatVisualMeshes = [mesh]; 
            
            const loadSpy = vi.spyOn(URDFLoader.prototype, 'loadAsync').mockResolvedValue(mockRobot);

            viewer.urdf = 'textured_robot.urdf';
            await waitForLoad(); 
            
            if (viewer.loader.manager.onLoad) {
                viewer.loader.manager.onLoad();
            }

            const updatedMaterials = mesh.material as THREE.Material[];
            
            expect(updatedMaterials[0]).toBeInstanceOf(THREE.MeshPhongMaterial);
            expect(updatedMaterials[1]).toBeInstanceOf(THREE.MeshPhongMaterial);
            
            const updatedMap = (updatedMaterials[0] as THREE.MeshPhongMaterial).map;
            expect(updatedMap).not.toBeNull();
            expect(updatedMap!.colorSpace).toBe(THREE.SRGBColorSpace);

            loadSpy.mockRestore();
        });

        it('should inject loadMeshFunc to the loader if defined by the user', async () => {
            const customFunc = async () => new THREE.Mesh();
            viewer.loadMeshFunc = customFunc;
            
            const loadSpy = vi.spyOn(URDFLoader.prototype, 'loadAsync').mockResolvedValue(new URDFRobot());
            viewer.urdf = 'robot.urdf'; 
            
            await waitForLoad();
            
            expect(viewer.loader.loadMeshFunc).toBe(customFunc);
            loadSpy.mockRestore();
        });

        it('should dispatch urdf-error if the load promise fails', async () => {
            const errorSpy = vi.fn();
            viewer.addEventListener('urdf-error', errorSpy);
            
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const loadSpy = vi.spyOn(URDFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('Network Fail'));
            
            viewer.urdf = 'fail.urdf';
            await waitForLoad();
            
            expect(errorSpy).toHaveBeenCalled();
            
            loadSpy.mockRestore();
            consoleSpy.mockRestore();
        });

        it('should abort current load and release resources if requestId changes due to a race condition', async () => {
            let resolveFirstLoad: (v: URDFRobot) => void;
            
            const slowPromise = new Promise<URDFRobot>(res => { resolveFirstLoad = res; });
            const unresolvedPromise = new Promise<URDFRobot>(() => {}); 
            
            const spy = vi.spyOn(URDFLoader.prototype, 'loadAsync')
                .mockReturnValueOnce(slowPromise)
                .mockReturnValueOnce(unresolvedPromise);
            
            const mockRobot = new URDFRobot();
            const mesh = new THREE.Mesh(new THREE.BufferGeometry());
            mesh.geometry.userData = { refCount: 1 };
            mockRobot.add(mesh);
            const disposeSpy = vi.spyOn(mesh.geometry, 'dispose');
            
            viewer.urdf = 'model1.urdf';
            vi.advanceTimersByTime(16); // Trigger Model 1 RAF
            
            viewer.urdf = 'model2.urdf'; 
            vi.advanceTimersByTime(16); // Overwrite URL, trigger Model 2 RAF
            
            resolveFirstLoad!(mockRobot);
            await flushPromises(); // Await slowPromise resolution internally
            
            expect(disposeSpy).toHaveBeenCalled();
            expect(viewer.robot).toBeNull(); 
            
            spy.mockRestore();
        });

        it('should remove the raycast property from colliders', () => {
            const mockRobot = new URDFRobot();
            const colMesh = new THREE.Mesh();
            (colMesh as unknown as { raycast: () => void }).raycast = () => {}; 
            
            mockRobot.flatColliderMeshes = [colMesh];
            viewer.robot = mockRobot;
            
            viewer.showCollision = true; 
            
            expect(Object.prototype.hasOwnProperty.call(colMesh, 'raycast')).toBe(false);
        });

        it('should calculate explicit +X, +Y, +Z axes in _setUp', () => {
            viewer.setAttribute('up', '+Z');
            expect(viewer.world.rotation.x).toBeCloseTo(-Math.PI / 2);

            viewer.setAttribute('up', '+X');
            expect(viewer.world.rotation.z).toBeCloseTo(Math.PI / 2);

            viewer.setAttribute('up', '+Y');
            expect(viewer.world.rotation.x).toBeCloseTo(0);
        });

        it('should dispatch ignore-limits-change when invoking the redraw attribute', () => {
            const eventSpy = vi.fn();
            viewer.addEventListener('ignore-limits-change', eventSpy);
            
            viewer.setAttribute('ignore-limits', 'true');
            
            expect(eventSpy).toHaveBeenCalled();
        });

        it('should invoke the "up" property setter correctly', () => {
            viewer.up = '+X';
            expect(viewer.getAttribute('up')).toBe('+X');
            expect(viewer.world.rotation.z).toBeCloseTo(Math.PI / 2);
        });

        it('should execute internal branches of _renderLoop evaluating isConnected and flags', () => {
            const renderSpy = vi.spyOn(viewer.renderer, 'render');
            const shadowSpy = vi.spyOn(getPrivates(viewer), '_updateShadowBounds');
            
            getPrivates(viewer)._shadowsNeedUpdate = true;
            viewer.autoRedraw = true;
            
            getPrivates(viewer)._renderLoop();
            
            expect(shadowSpy).toHaveBeenCalled();
            expect(renderSpy).toHaveBeenCalled();
            expect(getPrivates(viewer)._shadowsNeedUpdate).toBe(false);

            renderSpy.mockClear();
            shadowSpy.mockClear();

            viewer.remove();
            getPrivates(viewer)._renderLoop();
            
            expect(shadowSpy).not.toHaveBeenCalled();
            expect(renderSpy).not.toHaveBeenCalled();
        });

        it('should return early in _updateShadowBounds due to hysteresis', () => {
            const mockRobot = new URDFRobot();
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            mockRobot.flatVisualMeshes = [new THREE.Mesh(geometry)];
            viewer.robot = mockRobot;
            viewer.displayShadow = true;

            viewer.recenter(); 
            
            const camUpdateSpy = vi.spyOn(viewer.directionalLight.shadow.camera, 'updateProjectionMatrix');
            
            getPrivates(viewer)._updateShadowBounds(false);
            
            expect(camUpdateSpy).not.toHaveBeenCalled();
        });

        it('should clean the previous robot when scheduling a new load in _scheduleLoad', async () => {
            const mockRobot = new URDFRobot();
            const mesh = new THREE.Mesh(new THREE.BufferGeometry());
            mesh.geometry.userData = { refCount: 1 };
            mockRobot.add(mesh);
            
            viewer.robot = mockRobot;
            viewer.world.add(mockRobot);

            const disposeSpy = vi.spyOn(mesh.geometry, 'dispose');
            const removeSpy = vi.spyOn(viewer.world, 'remove');
            
            const loadSpy = vi.spyOn(URDFLoader.prototype, 'loadAsync').mockReturnValue(new Promise(() => {}));
            
            viewer.urdf = 'completely_new_robot.urdf';
            await waitForLoad();
            
            expect(disposeSpy).toHaveBeenCalled();
            expect(removeSpy).toHaveBeenCalledWith(mockRobot);
            expect(viewer.robot).toBeNull();
            
            loadSpy.mockRestore();
        });

        it('should traverse up the hierarchy to find and make the URDFCollider visible', () => {
            const mockRobot = new URDFRobot();
            
            const colliderNode = new THREE.Object3D();
            (colliderNode as unknown as { isURDFCollider: boolean }).isURDFCollider = true;
            colliderNode.visible = false; 
            
            const intermediateGroup = new THREE.Group();
            const colMesh = new THREE.Mesh();
            
            intermediateGroup.add(colMesh);
            colliderNode.add(intermediateGroup);
            
            mockRobot.flatColliderMeshes = [colMesh];
            viewer.robot = mockRobot;
            
            viewer.showCollision = true;
            
            expect(colliderNode.visible).toBe(true);
        });
    });
});