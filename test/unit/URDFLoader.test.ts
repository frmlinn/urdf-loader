import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mesh, Object3D } from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { URDFLoader } from '../../src/core/URDFLoader';
import { URDFRobot, URDFMimicJoint } from '../../src/core/URDFClasses';

// ==========================================
// MOCKS & UTILITIES
// ==========================================

/**
 * Creates an empty mock mesh to simulate asynchronous geometry loading.
 * @returns A promise resolving to a Three.js Object3D.
 */
async function emptyLoadMeshFunc(): Promise<Object3D> {
    const mesh = new Mesh();
    // Safely inject mock flag for test tracking
    Object.defineProperty(mesh, 'fromCallback', { value: true, writable: false });
    return mesh;
}

/**
 * Recursively asserts deep structural and property equality between two URDF structures.
 * * @param ra - The reference URDF node.
 * @param rb - The target URDF node to compare against.
 */
function compareRobots(ra: any, rb: any): void {
    if (ra.isURDFRobot) {
        expect(Object.keys(ra.links).sort()).toEqual(Object.keys(rb.links).sort());
        expect(Object.keys(ra.joints).sort()).toEqual(Object.keys(rb.joints).sort());
        expect(Object.keys(ra.colliders).sort()).toEqual(Object.keys(rb.colliders).sort());
        expect(Object.keys(ra.visual).sort()).toEqual(Object.keys(rb.visual).sort());
    }

    expect(ra.name).toEqual(rb.name);
    expect(ra.type).toEqual(rb.type);
    expect(ra.urdfName).toEqual(rb.urdfName);

    expect(ra.isMesh).toEqual(rb.isMesh);
    expect(ra.isURDFLink).toEqual(rb.isURDFLink);
    expect(ra.isURDFRobot).toEqual(rb.isURDFRobot);
    expect(ra.isURDFJoint).toEqual(rb.isURDFJoint);
    expect(ra.isURDFCollider).toEqual(rb.isURDFCollider);

    switch (ra.type) {
        case 'URDFJoint':
        case 'URDFMimicJoint':
            expect(ra.jointType).toEqual(rb.jointType);
            expect(ra.axis).toEqual(rb.axis);
            expect(ra.limit).toEqual(rb.limit);
            expect(ra.ignoreLimits).toEqual(rb.ignoreLimits);
            expect(ra.jointValue).toEqual(rb.jointValue);
            expect(ra.origPosition).toEqual(rb.origPosition);
            expect(ra.origQuaternion).toEqual(rb.origQuaternion);
            expect(ra.mimicJoints.map((x: any) => x.urdfName)).toEqual(rb.mimicJoints.map((x: any) => x.urdfName));

            if (ra.type === 'URDFMimicJoint') {
                expect(ra.mimicJoint).toEqual(rb.mimicJoint);
                expect(ra.offset).toEqual(rb.offset);
                expect(ra.multiplier).toEqual(rb.multiplier);
            }
            break;
    }

    for (let i = 0; i < ra.children.length; i++) {
        compareRobots(ra.children[i], rb.children[i]);
    }
}

// ==========================================
// CONFIGURATION & PARSING TESTS
// ==========================================
describe('URDFLoader - Configuration and Options', () => {
    describe('parseVisual, parseCollision', () => {
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

    describe('Package Resolution (packages)', () => {
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
            await new Promise(resolve => setTimeout(resolve, 5)); 
            
            expect(loadedUrl).toEqual('path/to/pkg1/path/model.stl');
        });

        it('should evaluate functional values to resolve paths dynamically', async () => {
            const loader = new URDFLoader();
            loader.packages = (pkg) => pkg === 'pkg1' ? 'func/path/1' : '';
            let loadedUrl = '';
            loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
            
            loader.parse(urdf);
            await new Promise(resolve => setTimeout(resolve, 5));
            
            expect(loadedUrl).toEqual('func/path/1/path/model.stl');
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

        robot.name = 'RENOMBRADO';
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
        
        const material = (res.children[0].children[0] as any).material;
        expect(material.name).toEqual('Cyan');
        expect(material.transparent).toEqual(true);
        expect(material.depthWrite).toEqual(false);
        expect(material.opacity).toEqual(0.5);
    });
});

describe('Mimic Tag Integrity (Logical Validation)', () => {
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

describe('Full Local File Parsing', () => {
    it('should parse local T12.URDF correctly and populate physical maps', () => {
        const loader = new URDFLoader();
        loader.packages = '/urdf';
        loader.loadMeshFunc = emptyLoadMeshFunc;

        const urdfPath = path.resolve(process.cwd(), 'urdf/T12/urdf/T12.URDF');
        const urdfContent = fs.readFileSync(urdfPath, 'utf8');

        const robot = loader.parse(urdfContent) as URDFRobot;

        expect(robot.isURDFRobot).toBe(true);
        expect(Object.keys(robot.links).length).toBeGreaterThan(0);
        expect(Object.keys(robot.joints).length).toBeGreaterThan(0);
    });
});

// ==========================================
// PHASE 1 & 2: NETWORK CYCLE AND API BOUNDARIES
// ==========================================
describe('Phase 1 & 2: Network Lifecycle and Native DOM Node Parsing', () => {
    let fetchSpy: any;

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
        } as Response);

        const loader = new URDFLoader();
        const robot = await loader.loadAsync('https://fake-server.com/robot.urdf');
        
        expect(fetchSpy).toHaveBeenCalledWith('https://fake-server.com/robot.urdf', expect.any(Object));
        expect(robot.robotName).toBe('NetworkRobot');

        fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response);
        await expect(loader.loadAsync('https://fake-server.com/missing.urdf')).rejects.toThrowError(/Failed to load url/i);
    });
});

// ==========================================
// PHASE 3: FAULT TOLERANCE
// ==========================================
describe('Phase 3: Mesh Fault Tolerance and Resiliency', () => {
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

        // Simulate catastrophic mesh failure
        loader.loadMeshFunc = async () => { throw new Error('Simulated Network Mesh Load Error'); };

        const robot = loader.parse(urdf);
        
        // Await microtasks execution
        await new Promise(resolve => setTimeout(resolve, 10));

        // Robot must survive retaining structural integrity
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
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(calls).toBe(3);
    });
});

// ==========================================
// PHASE 4: LARGE SCALE INTEGRATION
// ==========================================
describe('Phase 4: Stress Tests and Large Scale Parsing', () => {
    let fetchSpy: any;

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Generates dynamic large URDF strings for load-stressing the parser */
    const generateLargeURDF = (name: string, linkCount: number) => {
        let xml = `<robot name="${name}">\n<link name="link_0"/>\n`;
        for(let i = 1; i < linkCount; i++) {
            xml += `<link name="link_${i}"/>\n`;
            xml += `<joint name="joint_${i}" type="continuous"><parent link="link_${i-1}"/><child link="link_${i}"/></joint>\n`;
        }
        xml += `</robot>`;
        return xml;
    };

    it('should process a massive model structure like NASA Robonaut (128 links, 127 joints) without overflowing stack', async () => {
        fetchSpy.mockResolvedValue({
            ok: true, text: async () => generateLargeURDF('Robonaut_Mock', 128)
        } as Response);

        const loader = new URDFLoader();
        const robot = await loader.loadAsync('https://mock-nasa.gov/robonaut.urdf');

        expect(robot.robotName).toBe('Robonaut_Mock');
        expect(Object.keys(robot.links)).toHaveLength(128);
        expect(Object.keys(robot.joints)).toHaveLength(127);
    });

    it('should structurally parse a medium load model like NASA Valkyrie (69 links, 68 joints)', async () => {
        fetchSpy.mockResolvedValue({
            ok: true, text: async () => generateLargeURDF('Valkyrie_Mock', 69)
        } as Response);

        const loader = new URDFLoader();
        const robot = await loader.loadAsync('https://mock-nasa.gov/valkyrie.urdf');

        expect(robot.robotName).toBe('Valkyrie_Mock');
        expect(Object.keys(robot.links)).toHaveLength(69);
        expect(Object.keys(robot.joints)).toHaveLength(68);
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
        fetchSpy.mockResolvedValue({ ok: true, text: async () => multiPkgUrdf } as Response);

        const loader = new URDFLoader();
        loader.packages = {
            pkgA: 'https://ros-industrial.org/pkgA',
            pkgB: 'https://ros-industrial.org/pkgB'
        };

        const loadedUrls: string[] = [];
        loader.loadMeshFunc = async (url) => { loadedUrls.push(url); return new Mesh(); };

        await loader.loadAsync('https://mock.com/multipkg.urdf');
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(loadedUrls).toContain('https://ros-industrial.org/pkgA/mesh1.stl');
        expect(loadedUrls).toContain('https://ros-industrial.org/pkgB/mesh2.stl');
    });
});