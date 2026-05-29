import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Mesh, Object3D, Material, TextureLoader, Texture, BufferGeometry, Group, MeshPhongMaterial } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { URDFLoader } from '../../src/core/URDFLoader';
import { URDFRobot, URDFMimicJoint, URDFVisual } from '../../src/core/URDFClasses';

// ==========================================
// MOCKS & UTILITIES
// ==========================================

/**
 * Flushes the microtask queue to process pending Promises 
 * without introducing artificial setTimeout delays blocking the event loop.
 */
const flushPromises = () => new Promise(resolve => process.nextTick(resolve));

/**
 * Creates an empty mock mesh to simulate asynchronous geometry loading.
 * @returns A promise resolving to a Three.js Object3D.
 */
async function emptyLoadMeshFunc(): Promise<Object3D> {
    const mesh = new Mesh();
    Object.defineProperty(mesh, 'fromCallback', { value: true, writable: false });
    return mesh;
}

/**
 * Recursively asserts deep structural and property equality between two URDF structures.
 * @param ra - The reference URDF node.
 * @param rb - The target URDF node to compare against.
 */
function compareRobots(ra: unknown, rb: unknown): void {
    type CompareNode = URDFRobot & URDFMimicJoint & {
        isMesh?: boolean;
        isURDFLink?: boolean;
        isURDFRobot?: boolean;
        isURDFJoint?: boolean;
        isURDFCollider?: boolean;
    };

    const a = ra as CompareNode;
    const b = rb as CompareNode;

    if (a.isURDFRobot) {
        expect(Object.keys(a.links).sort()).toEqual(Object.keys(b.links).sort());
        expect(Object.keys(a.joints).sort()).toEqual(Object.keys(b.joints).sort());
        expect(Object.keys(a.colliders).sort()).toEqual(Object.keys(b.colliders).sort());
        expect(Object.keys(a.visual).sort()).toEqual(Object.keys(b.visual).sort());
    }

    expect(a.name).toEqual(b.name);
    expect(a.type).toEqual(b.type);
    expect(a.urdfName).toEqual(b.urdfName);

    expect(a.isMesh).toEqual(b.isMesh);
    expect(a.isURDFLink).toEqual(b.isURDFLink);
    expect(a.isURDFRobot).toEqual(b.isURDFRobot);
    expect(a.isURDFJoint).toEqual(b.isURDFJoint);
    expect(a.isURDFCollider).toEqual(b.isURDFCollider);

    switch (a.type) {
        case 'URDFJoint':
        case 'URDFMimicJoint':
            expect(a.jointType).toEqual(b.jointType);
            expect(a.axis).toEqual(b.axis);
            expect(a.limit).toEqual(b.limit);
            expect(a.ignoreLimits).toEqual(b.ignoreLimits);
            expect(a.jointValue).toEqual(b.jointValue);
            expect(a.origPosition).toEqual(b.origPosition);
            expect(a.origQuaternion).toEqual(b.origQuaternion);
            expect(a.mimicJoints.map((x: URDFMimicJoint) => x.urdfName)).toEqual(b.mimicJoints.map((x: URDFMimicJoint) => x.urdfName));

            if (a.type === 'URDFMimicJoint') {
                expect(a.mimicJoint).toEqual(b.mimicJoint);
                expect(a.offset).toEqual(b.offset);
                expect(a.multiplier).toEqual(b.multiplier);
            }
            break;
    }

    for (let i = 0; i < a.children.length; i++) {
        compareRobots(a.children[i], b.children[i]);
    }
}

// ==========================================
// CONFIGURATION & PARSING TESTS
// ==========================================
describe('URDFLoader - Configuration and Options', () => {
    describe('parseVisual & parseCollision', () => {
        const urdfXML = `
            <robot name="TEST">
                <link name="LINK1">
                    <visual><geometry><box size="1 1 1"/></geometry></visual>
                    <collision><geometry><box size="1 1 1"/></geometry></collision>
                </link>
            </robot>
        `;

        it('should exclude geometric elements if configuration flags are false', () => {
            const loader = new URDFLoader();
            loader.parseVisual = false;
            loader.parseCollision = false;
            const robot = loader.parse(urdfXML);
            
            let visTotal = 0; let colTotal = 0;
            robot.traverse(c => {
                if ('isURDFCollider' in c) colTotal++;
                if ('isURDFVisual' in c) visTotal++;
            });

            expect(visTotal).toBe(0);
            expect(colTotal).toBe(0);
        });

        it('should include geometric elements if configuration flags are true', () => {
            const loader = new URDFLoader();
            loader.parseVisual = true;
            loader.parseCollision = true;
            const robot = loader.parse(urdfXML);
            
            let visTotal = 0; let colTotal = 0;
            robot.traverse(c => {
                if ('isURDFCollider' in c) colTotal++;
                if ('isURDFVisual' in c) visTotal++;
            });

            expect(visTotal).toBe(1);
            expect(colTotal).toBe(1);
        });
    });

    describe('Package Resolution', () => {
        const urdf = `
            <robot name="TEST">
                <link name="Body">
                    <visual><geometry><mesh filename="package://pkg1/path/model.stl" /></geometry></visual>
                </link>
            </robot>
        `;

        it('should use object maps to resolve external paths', async () => {
            const loader = new URDFLoader();
            loader.packages = { 'pkg1': 'path/to/pkg1' };
            let loadedUrl = '';
            loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
            
            loader.parse(urdf);
            await flushPromises(); 
            
            expect(loadedUrl).toEqual('path/to/pkg1/path/model.stl');
        });

        it('should evaluate functional values to resolve paths dynamically', async () => {
            const loader = new URDFLoader();
            loader.packages = (pkg) => pkg === 'pkg1' ? 'func/path/1' : '';
            let loadedUrl = '';
            loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
            
            loader.parse(urdf);
            await flushPromises();
            
            expect(loadedUrl).toEqual('func/path/1/path/model.stl');
        });

        // ==========================================
        // COVERAGE 2: Return null fallback for unsupported configurations
        // ==========================================
        it('should return null when resolving package paths if packages config is of an unsupported type', async () => {
            const loader = new URDFLoader();
            loader.packages = 123 as unknown as string; 
            let loadedUrl: string | null = 'not-called';
            loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
            
            loader.parse(urdf);
            await flushPromises(); 
            
            // Si retorna null en el scope de resolvePath, loadMeshFunc no se llama
            expect(loadedUrl).toEqual('not-called'); 
        });
    });
});

describe('Cloning Mechanism', () => {
    it('should clone an URDF robot structure accurately even after renaming', () => {
        const loader = new URDFLoader();
        const robot = loader.parse(`
            <robot name="ORIGINAL">
                <link name="L1"/>
                <joint name="J1" type="continuous"><parent link="L1"/><child link="L2"/></joint>
                <link name="L2"/>
            </robot>
        `) as URDFRobot;

        compareRobots(robot, robot.clone());

        robot.name = 'RENAMED';
        compareRobots(robot, robot.clone());
    });
});

describe('Material Tag Parsing', () => {
    it('should correctly parse RGBA colors, transparency, and material names', () => {
        const loader = new URDFLoader();
        const res = loader.parse(`
            <robot name="TEST">
                <material name="Cyan"><color rgba="0 1.0 1.0 0.5"/></material>
                <link name="LINK">
                    <visual><geometry><box size="1 1 1"/></geometry><material name="Cyan"/></visual>
                </link>
            </robot>
        `);
        
        const material = (res.children[0].children[0] as Mesh).material as Material & { transparent: boolean, depthWrite: boolean, opacity: number };
        expect(material.name).toEqual('Cyan');
        expect(material.transparent).toEqual(true);
        expect(material.depthWrite).toEqual(false);
        expect(material.opacity).toEqual(0.5);
    });
});

describe('Mimic Tag Integrity', () => {
    it('should throw an error and abort when encountering infinite mimic loops', () => {
        const loader = new URDFLoader();
        const urdf = `
            <robot name="TEST">
                <link name="L1"/><link name="L2"/><link name="L3"/>
                <joint name="A" type="continuous"><parent link="L1"/><child link="L2"/><mimic joint="B"/></joint>
                <joint name="B" type="continuous"><parent link="L2"/><child link="L3"/><mimic joint="A"/></joint>
            </robot>
        `;
        expect(() => loader.parse(urdf)).toThrowError(/Detected an infinite loop of mimic joints/i);
    });

    it('should default to multiplier 1.0 and offset 0.0 when mimic properties are missing', () => {
        const loader = new URDFLoader();
        const res = loader.parse(`
            <robot name="TEST">
                <link name="L1"/><link name="L2"/><link name="L3"/>
                <joint name="A" type="continuous"><parent link="L1"/><child link="L2"/></joint>
                <joint name="B" type="continuous"><parent link="L2"/><child link="L3"/><mimic joint="A"/></joint>
            </robot>
        `);
        const jointB = res.joints['B'] as URDFMimicJoint;
        expect(jointB.multiplier).toEqual(1);
        expect(jointB.offset).toEqual(0);
    });
});

describe('Structural Data Parsing', () => {
    it('should parse a complex URDF string correctly and populate physical maps without I/O', () => {
        const loader = new URDFLoader();
        loader.packages = '/urdf';
        loader.loadMeshFunc = emptyLoadMeshFunc;

        const urdfContent = `
            <robot name="MockBot">
                <link name="base_link">
                    <visual><geometry><mesh filename="package://mesh.stl"/></geometry></visual>
                    <collision><geometry><box size="1 1 1"/></geometry></collision>
                    <inertial><mass value="10.0"/><origin xyz="0 0 0" rpy="0 0 0"/></inertial>
                </link>
                <link name="leg_1" />
                <joint name="j1" type="revolute">
                    <parent link="base_link"/>
                    <child link="leg_1"/>
                    <limit effort="10" lower="-1" upper="1" velocity="5"/>
                </joint>
            </robot>
        `;

        const robot = loader.parse(urdfContent) as URDFRobot;

        expect(robot.isURDFRobot).toBe(true);
        expect(Object.keys(robot.links).length).toBeGreaterThan(0);
        expect(Object.keys(robot.joints).length).toBeGreaterThan(0);
        expect(robot.robotName).toBe('MockBot');
    });

    // ==========================================
    // COVERAGE 3, 4, 5, 6: Orígenes, Escalas y Materiales Inline
    // ==========================================
    it('should parse inline visual materials, mesh scales, visual origins, and joint origins', async () => {
        const loader = new URDFLoader();
        loader.loadMeshFunc = emptyLoadMeshFunc;
        
        const urdf = `
            <robot name="FullParse">
                <link name="L1">
                    <visual>
                        <origin xyz="1 2 3" rpy="0 1.570796 0"/>
                        <geometry><mesh filename="dummy.stl" scale="2 3 4"/></geometry>
                        <material><color rgba="1 0.5 0.2 1"/></material>
                    </visual>
                </link>
                <link name="L2"/>
                <joint name="J1" type="fixed">
                    <origin xyz="4 5 6" rpy="0 0 1.570796"/>
                    <parent link="L1"/>
                    <child link="L2"/>
                </joint>
            </robot>
        `;
        
        const robot = loader.parse(urdf) as URDFRobot;
        await flushPromises();

        const joint = robot.joints['J1'];
        expect(joint.position.toArray()).toEqual([4, 5, 6]);
        expect(joint.rotation.z).toBeCloseTo(1.570796);

        const visual = robot.links['L1'].children.find(c => c.type === 'URDFVisual') as URDFVisual;
        expect(visual.position.toArray()).toEqual([1, 2, 3]);
        expect(visual.rotation.y).toBeCloseTo(1.570796);

        expect(visual.scale.toArray()).toEqual([2, 3, 4]);
        
        const mesh = visual.children[0] as Mesh;
        const material = mesh.material as MeshPhongMaterial;
        expect(material.color.r).toBeCloseTo(1);
        expect(material.color.g).toBeCloseTo(0.5);
        expect(material.color.b).toBeCloseTo(0.2);
    });
});

// ==========================================
// NETWORK CYCLE & API BOUNDARIES
// ==========================================
describe('Network Lifecycle & Native DOM Node Parsing', () => {
    let fetchSpy: MockInstance;

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should process a native pre-parsed XML Document instance', () => {
        const loader = new URDFLoader();
        const mockURDF = `<robot name="DOMRobot"><link name="L1"/></robot>`;
        const xmlDoc = new DOMParser().parseFromString(mockURDF, 'text/xml');

        const robot = loader.parse(xmlDoc);
        expect(robot.robotName).toBe('DOMRobot');
        expect(Object.keys(robot.links)).toHaveLength(1);
    });

    it('should process a native XML Element root node instance', () => {
        const loader = new URDFLoader();
        const mockURDF = `<robot name="ElementRobot"><link name="L1"/></robot>`;
        const xmlDoc = new DOMParser().parseFromString(mockURDF, 'text/xml');
        const rootElement = Array.from(xmlDoc.children).find(c => c.nodeName === 'robot') as Element;

        const robot = loader.parse(rootElement);
        expect(robot.robotName).toBe('ElementRobot');
    });

    it('should issue a fetch request in loadAsync and reject upon 404', async () => {
        fetchSpy.mockResolvedValueOnce({
            ok: true, text: async () => `<robot name="NetworkRobot"><link name="Base"/></robot>`
        } as unknown as Response);

        const loader = new URDFLoader();
        const robot = await loader.loadAsync('https://fake-server.com/robot.urdf');
        
        expect(fetchSpy).toHaveBeenCalledWith('https://fake-server.com/robot.urdf', expect.any(Object));
        expect(robot.robotName).toBe('NetworkRobot');

        fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as unknown as Response);
        await expect(loader.loadAsync('https://fake-server.com/missing.urdf')).rejects.toThrowError(/Failed to load url/i);
    });

    // ==========================================
    // COVERAGE 1: console.error genérico al fallar sin callback
    // ==========================================
    it('should fallback to console.error when load fails and no onError callback is provided', async () => {
        fetchSpy.mockRejectedValueOnce(new Error('Network Fail'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        const loader = new URDFLoader();
        loader.load('fail.urdf');
        
        await flushPromises();
        
        expect(consoleSpy).toHaveBeenCalledWith('URDFLoader: Error loading file.', expect.any(Error));
        consoleSpy.mockRestore();
    });
});

// ==========================================
// FAULT TOLERANCE
// ==========================================
describe('Mesh Fault Tolerance and Resiliency', () => {
    it('should complete topological instantiation gracefully even if a mesh fetch fails', async () => {
        const loader = new URDFLoader();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const urdf = `
            <robot name="ResilientRobot">
                <link name="Base">
                    <visual><geometry><mesh filename="broken_file.stl" /></geometry></visual>
                </link>
            </robot>
        `;

        loader.loadMeshFunc = async () => { throw new Error('Simulated Network Mesh Load Error'); };

        const robot = loader.parse(urdf);
        
        await flushPromises();

        expect(robot.robotName).toBe('ResilientRobot');
        expect(Object.keys(robot.links)).toHaveLength(1);
        expect(consoleSpy).toHaveBeenCalledWith('URDFLoader: Error loading mesh.', expect.any(Error));

        consoleSpy.mockRestore();
    });

    it('should fire loadMeshFunc exactly matching the total mesh count', async () => {
        const loader = new URDFLoader();
        let calls = 0;
        loader.loadMeshFunc = async () => { calls++; return new Mesh(); };

        const urdf = `
            <robot name="MultiMesh">
                <link name="L1">
                    <visual><geometry><mesh filename="1.stl"/></geometry></visual>
                    <visual><geometry><mesh filename="2.stl"/></geometry></visual>
                </link>
                <link name="L2">
                    <visual><geometry><mesh filename="3.stl"/></geometry></visual>
                </link>
            </robot>`;

        loader.parse(urdf);
        await flushPromises();

        expect(calls).toBe(3);
    });
});

// ==========================================
// LARGE SCALE INTEGRATION
// ==========================================
describe('Stress Tests and Large Scale Parsing', () => {
    let fetchSpy: MockInstance;

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const generateLargeURDF = (name: string, linkCount: number) => {
        let xml = `<robot name="${name}">\n<link name="link_0"/>\n`;
        for(let i = 1; i < linkCount; i++) {
            xml += `<link name="link_${i}"/>\n`;
            xml += `<joint name="joint_${i}" type="continuous"><parent link="link_${i-1}"/><child link="link_${i}"/></joint>\n`;
        }
        xml += `</robot>`;
        return xml;
    };

    it('should process a massive model structure (128 links, 127 joints) without overflowing the stack', async () => {
        fetchSpy.mockResolvedValue({
            ok: true, text: async () => generateLargeURDF('Robonaut_Mock', 128)
        } as unknown as Response);

        const loader = new URDFLoader();
        const robot = await loader.loadAsync('https://mock-nasa.gov/robonaut.urdf');

        expect(robot.robotName).toBe('Robonaut_Mock');
        expect(Object.keys(robot.links)).toHaveLength(128);
        expect(Object.keys(robot.joints)).toHaveLength(127);
    });

    it('should correctly resolve a complex multi-package ROS Industrial robot string', async () => {
        const multiPkgUrdf = `
            <robot name="MultiPkg">
                <link name="Tool">
                    <visual><geometry><mesh filename="package://pkgA/mesh1.stl"/></geometry></visual>
                </link>
                <link name="Base">
                    <visual><geometry><mesh filename="package://pkgB/mesh2.stl"/></geometry></visual>
                </link>
            </robot>
        `;
        fetchSpy.mockResolvedValue({ ok: true, text: async () => multiPkgUrdf } as unknown as Response);

        const loader = new URDFLoader();
        loader.packages = {
            pkgA: 'https://ros-industrial.org/pkgA',
            pkgB: 'https://ros-industrial.org/pkgB'
        };

        const loadedUrls: string[] = [];
        loader.loadMeshFunc = async (url) => { loadedUrls.push(url); return new Mesh(); };

        await loader.loadAsync('https://mock.com/multipkg.urdf');
        await flushPromises();

        expect(loadedUrls).toContain('https://ros-industrial.org/pkgA/mesh1.stl');
        expect(loadedUrls).toContain('https://ros-industrial.org/pkgB/mesh2.stl');
    });
});

describe('Native Primitives, Textures and Material Assignment', () => {
    it('should properly instantiate box, sphere, cylinder geometries and apply textures', async () => {
        const loader = new URDFLoader();
        
        const textureLoaderSpy = vi.spyOn(TextureLoader.prototype, 'load').mockReturnValue(new Texture());
        
        const urdf = `
            <robot name="Primitives">
                <material name="TexMat">
                    <texture filename="dummy.png"/>
                </material>
                <link name="BoxLink">
                    <visual name="BoxVis"><geometry><box size="1 2 3"/></geometry><material name="TexMat"/></visual>
                </link>
                <link name="SphereLink">
                    <visual name="SphereVis"><geometry><sphere radius="5"/></geometry></visual>
                </link>
                <link name="CylLink">
                    <visual name="CylVis"><geometry><cylinder radius="2" length="10"/></geometry></visual>
                </link>
                
                <joint name="J1" type="fixed"><parent link="BoxLink"/><child link="SphereLink"/></joint>
                <joint name="J2" type="fixed"><parent link="BoxLink"/><child link="CylLink"/></joint>
            </robot>
        `;
        
        const robot = loader.parse(urdf);
        await flushPromises(); 
        
        const boxVis = robot.visual['BoxVis'];
        const boxMesh = boxVis.children[0] as Mesh;
        expect(boxMesh.geometry.type).toBe('BoxGeometry');
        expect(boxMesh.scale.toArray()).toEqual([1, 2, 3]);
        expect((boxMesh.material as MeshPhongMaterial).map).toBeInstanceOf(Texture);
        
        const sphereVis = robot.visual['SphereVis'];
        const sphereMesh = sphereVis.children[0] as Mesh;
        expect(sphereMesh.geometry.type).toBe('SphereGeometry');
        expect(sphereMesh.scale.toArray()).toEqual([5, 5, 5]);

        const cylVis = robot.visual['CylVis'];
        const cylMesh = cylVis.children[0] as Mesh;
        expect(cylMesh.geometry.type).toBe('CylinderGeometry');
        expect(cylMesh.scale.toArray()).toEqual([2, 10, 2]);

        textureLoaderSpy.mockRestore();
    });

    it('should assign parsed URDF materials and position vectors to loaded external meshes', async () => {
        const loader = new URDFLoader();
        const loadedMesh = new Mesh(new BufferGeometry());
        
        loader.loadMeshFunc = async () => loadedMesh;
        
        const urdf = `
            <robot name="MatTest">
                <material name="Red"><color rgba="1 0 0 1"/></material>
                <link name="L1">
                    <visual><geometry><mesh filename="dummy.stl"/></geometry><material name="Red"/></visual>
                </link>
            </robot>
        `;
        
        loader.parse(urdf);
        await flushPromises(); 
        
        expect((loadedMesh.material as MeshPhongMaterial).color.r).toBe(1);
        expect(loadedMesh.position.toArray()).toEqual([0, 0, 0]);
        // Also asserts that the retained resource hook logic was triggered
        expect(loadedMesh.geometry.userData?.refCount).toBeDefined();
    });
});

describe('Internal DefaultMeshLoader and Edge Cases', () => {
    it('should route to STLLoader for .stl extensions and generate a mesh with bounding volumes', async () => {
        const loader = new URDFLoader();
        const stlLoadSpy = vi.spyOn(STLLoader.prototype, 'loadAsync').mockResolvedValue(new BufferGeometry());
        
        const result = await loader.defaultMeshLoader('model.stl', loader.manager) as Mesh;
        
        expect(stlLoadSpy).toHaveBeenCalledWith('model.stl');
        expect(result.geometry.type).toBe('BufferGeometry');
        expect(result.geometry.boundingBox).toBeDefined(); 
        
        stlLoadSpy.mockRestore();
    });

    it('should route to ColladaLoader for .dae extensions and extract the parsed scene', async () => {
        const loader = new URDFLoader();
        const dummyScene = new Group();
        dummyScene.add(new Mesh(new BufferGeometry())); 
        
        // FIX: Evita el uso de "as any" empleando una coerción indirecta que satisface estrictamente a TypeScript
        const daeLoadSpy = vi.spyOn(ColladaLoader.prototype, 'loadAsync').mockResolvedValue({ scene: dummyScene } as unknown as never);
        
        const result = await loader.defaultMeshLoader('model.dae', loader.manager);
        
        expect(daeLoadSpy).toHaveBeenCalledWith('model.dae');
        expect(result).toBe(dummyScene);
        
        daeLoadSpy.mockRestore();
    });

    it('should log a warning and return null for unsupported mesh extensions', async () => {
        const loader = new URDFLoader();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        
        const result = await loader.defaultMeshLoader('model.obj', loader.manager);
        
        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No loader available for extension .obj'));
        
        consoleSpy.mockRestore();
    });

    it('should log an error and return null when package is missing from the dictionary', () => {
        const loader = new URDFLoader();
        loader.packages = { 'known_pkg': '/path/' };
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        const urdf = `
            <robot name="PkgErr">
                <link name="L1">
                    <visual><geometry><mesh filename="package://unknown_pkg/mesh.stl"/></geometry></visual>
                </link>
            </robot>
        `;
        
        loader.parse(urdf);
        
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unknown_pkg not found in provided package list'));
        consoleSpy.mockRestore();
    });

    it('should trigger onProgress callback if provided to the load method', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true, text: async () => '<robot name="Prog"><link name="L1"/></robot>'
        } as Response);
        
        const loader = new URDFLoader();
        const progressSpy = vi.fn();
        
        await new Promise<void>(resolve => {
            loader.load('test.urdf', () => resolve(), progressSpy);
        });
        
        expect(progressSpy).toHaveBeenCalled();
        expect(progressSpy.mock.calls[0][0]).toBeInstanceOf(ProgressEvent);
        
        fetchSpy.mockRestore();
    });
});