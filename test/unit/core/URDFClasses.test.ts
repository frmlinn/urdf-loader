import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vector3, Mesh, BufferGeometry, MeshBasicMaterial, Texture, Material } from 'three';
import { URDFLoader } from '../../../src/core/URDFLoader';
import { 
    retainResource, 
    releaseResource, 
    retainMeshResources, 
    releaseMeshResources, 
    URDFJoint, 
    URDFMimicJoint, 
    URDFRobot 
} from '../../../src/core/URDFClasses';

type MockResource = { dispose: () => void; userData?: { refCount?: number } };

describe('URDFClasses Module', () => {

    // =========================================================================
    // SECTION: Memory Management (Reference Counting Utilities)
    // =========================================================================
    describe('Memory Management Utilities', () => {
        
        describe('retainResource() & releaseResource()', () => {
            it('should properly increment and decrement refCount for a single resource', () => {
                const resource = { dispose: vi.fn() } as MockResource;
                
                retainResource(resource);
                expect(resource.userData?.refCount).toBe(1);
                
                retainResource(resource);
                expect(resource.userData?.refCount).toBe(2);
                
                releaseResource(resource);
                expect(resource.userData?.refCount).toBe(1);
                expect(resource.dispose).not.toHaveBeenCalled();
                
                releaseResource(resource);
                expect(resource.userData?.refCount).toBeUndefined();
                expect(resource.dispose).toHaveBeenCalledOnce();
            });

            it('should handle arrays of resources seamlessly', () => {
                const resA = { dispose: vi.fn() } as MockResource;
                const resB = { dispose: vi.fn() } as MockResource;
                
                retainResource([resA, resB]);
                expect(resA.userData?.refCount).toBe(1);
                expect(resB.userData?.refCount).toBe(1);
                
                releaseResource([resA, resB]);
                expect(resA.dispose).toHaveBeenCalled();
                expect(resB.dispose).toHaveBeenCalled();
            });

            it('should safely ignore null or undefined resources', () => {
                expect(() => retainResource(null)).not.toThrow();
                expect(() => releaseResource(undefined)).not.toThrow();
            });

            it('should safely release resources that do not have a dispose method', () => {
                const resource = { userData: { refCount: 1 } } as MockResource;
                
                expect(() => releaseResource(resource)).not.toThrow();
                expect(resource.userData?.refCount).toBeUndefined();
            });
        });

        describe('retainMeshResources() & releaseMeshResources()', () => {
            it('should retain and release entire Mesh resources (Geometry, Material, Textures)', () => {
                const geometry = new BufferGeometry();
                const texture = new Texture();
                const material = new MeshBasicMaterial({ map: texture });
                const mesh = new Mesh(geometry, material);

                geometry.dispose = vi.fn();
                texture.dispose = vi.fn();
                material.dispose = vi.fn();

                retainMeshResources(mesh);
                
                expect(geometry.userData.refCount).toBe(1);
                expect(material.userData.refCount).toBe(1);
                expect(texture.userData.refCount).toBe(1);

                releaseMeshResources(mesh);

                expect(geometry.dispose).toHaveBeenCalled();
                expect(material.dispose).toHaveBeenCalled();
                expect(texture.dispose).toHaveBeenCalled();
            });

            it('should safely handle retaining and releasing meshes without geometry or materials', () => {
                const mesh = new Mesh();
                
                mesh.geometry = null as unknown as BufferGeometry;
                mesh.material = null as unknown as Material;

                expect(() => retainMeshResources(mesh)).not.toThrow();
                expect(() => releaseMeshResources(mesh)).not.toThrow();
            });

            it('should handle retaining and releasing meshes with an array of materials', () => {
                const geometry = new BufferGeometry();
                const mat1 = new MeshBasicMaterial();
                const mat2 = new MeshBasicMaterial();
                
                const mesh = new Mesh(geometry, [mat1, mat2]);

                retainMeshResources(mesh);
                
                expect(mat1.userData.refCount).toBe(1);
                expect(mat2.userData.refCount).toBe(1);

                releaseMeshResources(mesh);
                
                expect(mat1.userData?.refCount).toBeUndefined();
                expect(mat2.userData?.refCount).toBeUndefined();
            });
        });
    });

    // =========================================================================
    // SECTION: Class: URDFJoint
    // =========================================================================
    describe('Class: URDFJoint', () => {

        describe('constructor & state parameters', () => {
            it('should enforce the default (1, 0, 0) normalized axis vector', () => {
                const joint1 = new URDFJoint();
                expect(joint1.axis.equals(new Vector3(1, 0, 0))).toBeTruthy();

                joint1.axis.x = 2;
                const joint2 = new URDFJoint().copy(joint1);
                joint1.axis.x = 3;
                expect(joint1.axis.equals(new Vector3(3, 0, 0))).toBeTruthy();
                expect(joint2.axis.equals(new Vector3(2, 0, 0))).toBeTruthy();
            });

            it('should define the correct jointValue array length according to jointType', () => {
                const joint = new URDFJoint();
                const types = ['revolute', 'prismatic', 'continuous', 'planar', 'floating', 'fixed'] as const;
                const lengths = [1, 1, 1, 3, 6, 0];

                types.forEach((type, index) => {
                    joint.jointType = type;
                    expect(joint.jointValue).toHaveLength(lengths[index]);
                });
            });
        });

        describe('setJointValue()', () => {
            it('should respect upper and lower joint limits for revolute and prismatic joints', () => {
                const joint = new URDFJoint();
                joint.limit.upper = 1;
                joint.limit.lower = -1;
                joint.axis = new Vector3(0, 0, 1);

                joint.jointType = 'revolute';
                joint.setJointValue(0.5);
                expect(joint.jointValue).toEqual([0.5]);
                joint.setJointValue(1.5); // Overshoot
                expect(joint.jointValue).toEqual([1]);
                joint.setJointValue(-1.5); // Undershoot
                expect(joint.jointValue).toEqual([-1]);

                joint.jointType = 'prismatic';
                joint.setJointValue(0.5);
                expect(joint.jointValue).toEqual([0.5]);
                joint.setJointValue(1.5); 
                expect(joint.jointValue).toEqual([1]);
                joint.setJointValue(-1.5); 
                expect(joint.jointValue).toEqual([-1]);

                // Continuous joints lack physical limits
                joint.jointType = 'continuous';
                joint.setJointValue(0.5);
                expect(joint.jointValue).toEqual([0.5]);
                joint.setJointValue(1.5);
                expect(joint.jointValue).toEqual([1.5]);
                joint.setJointValue(-1.5);
                expect(joint.jointValue).toEqual([-1.5]);
            });

            it('should bypass kinematic constraints when ignoreLimits is true', () => {
                const joint = new URDFJoint();
                joint.limit.upper = 1;
                joint.limit.lower = -1;
                joint.ignoreLimits = true;
                joint.axis = new Vector3(0, 0, 1);

                joint.jointType = 'revolute';
                joint.setJointValue(1.5);
                expect(joint.jointValue).toEqual([1.5]);
                
                joint.jointType = 'prismatic';
                joint.setJointValue(1.5);
                expect(joint.jointValue).toEqual([1.5]);
            });

            it('should strictly return true if and only if the joint value mathematically changes', () => {
                const joint = new URDFJoint();
                joint.limit.upper = 1;
                joint.limit.lower = -1;
                joint.axis = new Vector3(0, 0, 1);

                joint.jointType = 'revolute';
                joint.matrixWorldNeedsUpdate = false;
                
                // Initial valid update
                expect(joint.setJointValue(0.5)).toBeTruthy();
                expect(joint.matrixWorldNeedsUpdate).toBeTruthy();

                // Identical value override
                joint.matrixWorldNeedsUpdate = false;
                expect(joint.setJointValue(0.5)).toBeFalsy();
                expect(joint.matrixWorldNeedsUpdate).toBeFalsy();

                // Pushed to physical limit (valid)
                expect(joint.setJointValue(1.5)).toBeTruthy();

                // Exceeding limit again (internally clipped to 1, effectively no change)
                expect(joint.setJointValue(1.5)).toBeFalsy();

                // Repeat checks for prismatic linear behavior
                joint.jointType = 'prismatic';
                expect(joint.setJointValue(0.5)).toBeTruthy();
                expect(joint.setJointValue(0.5)).toBeFalsy();
            });

            it('should safely ignore null values without mutating state', () => {
                const joint = new URDFJoint();
                joint.axis = new Vector3(0, 0, 1);
                
                joint.jointType = 'revolute';
                expect(joint.setJointValue(null)).toBe(false);
                
                joint.jointType = 'prismatic';
                expect(joint.setJointValue(null)).toBe(false);
            });

            it('should return false if prismatic clipping results in no mathematical change', () => {
                const joint = new URDFJoint();
                joint.axis = new Vector3(1, 0, 0);
                joint.jointType = 'prismatic';
                joint.limit.upper = 1.0;
                joint.limit.lower = -1.0;

                expect(joint.setJointValue(1.0)).toBeTruthy();
                
                expect(joint.setJointValue(1.5)).toBeFalsy();
                expect(joint.jointValue).toEqual([1.0]);
            });

            it('should correctly parse string values for revolute joints', () => {
                const joint = new URDFJoint();
                joint.jointType = 'revolute';
                joint.ignoreLimits = true;
                
                joint.setJointValue('1.5');
                expect(joint.angle).toBe(1.5);
            });

            it('should correctly parse string values for prismatic joints', () => {
                const joint = new URDFJoint();
                joint.jointType = 'prismatic';
                joint.ignoreLimits = true;
                
                joint.setJointValue('2.5');
                expect(joint.angle).toBe(2.5);
            });

            it('should compose position and rotation correctly for planar joints (3 DOF)', () => {
                const joint = new URDFJoint();
                joint.jointType = 'planar'; 
                
                const updated = joint.setJointValue(1.5, -2.0, Math.PI / 2);
                
                expect(updated).toBeTruthy();
                expect(joint.jointValue).toEqual([1.5, -2.0, Math.PI / 2]);
                expect(joint.position.x).toBeCloseTo(1.5);
                expect(joint.position.y).toBeCloseTo(-2.0);
                expect(joint.rotation.z).toBeCloseTo(Math.PI / 2);
            });

            it('should silently ignore planar joint updates if values are unchanged or null', () => {
                const joint = new URDFJoint();
                joint.jointType = 'planar';
                joint.setJointValue(1, 1, 0);
                
                expect(joint.setJointValue(1, 1, 0)).toBeFalsy();
                expect(joint.setJointValue(null, null, null)).toBeFalsy();
                expect(joint.setJointValue(2, 2, null)).toBeTruthy();
                expect(joint.jointValue).toEqual([2, 2, 0]);
            });

            it('should correctly parse string values for planar joints', () => {
                const joint = new URDFJoint();
                joint.jointType = 'planar';
                
                joint.setJointValue('1.5', '-2.0', '3.14');
                expect(joint.jointValue).toEqual([1.5, -2.0, 3.14]);
            });

            it('should compose 3D position and rotation correctly for floating joints (6 DOF)', () => {
                const joint = new URDFJoint();
                joint.jointType = 'floating';
                
                const updated = joint.setJointValue(10, 20, 30, Math.PI, 0, Math.PI / 2);
                
                expect(updated).toBeTruthy();
                expect(joint.jointValue).toEqual([10, 20, 30, Math.PI, 0, Math.PI / 2]);
                expect(joint.position.x).toBeCloseTo(10);
                expect(joint.rotation.x).toBeCloseTo(Math.PI);
            });

            it('should silently ignore floating joint updates if values are unchanged or null', () => {
                const joint = new URDFJoint();
                joint.jointType = 'floating';
                joint.setJointValue(1, 2, 3, 0, 0, 0);
                
                expect(joint.setJointValue(1, 2, 3, 0, 0, 0)).toBeFalsy();
                expect(joint.setJointValue(null, null, null, null, null, null)).toBeFalsy();
            });

            it('should correctly parse string values for floating joints', () => {
                const joint = new URDFJoint();
                joint.jointType = 'floating';
                
                joint.setJointValue('1', '2', '3', '4', '5', '6');
                expect(joint.jointValue).toEqual([1, 2, 3, 4, 5, 6]);
            });
        });

        describe('copy()', () => {
            it('should copy a joint correctly when origPosition and origQuaternion are null', () => {
                const joint = new URDFJoint();
                
                const clonedJoint = new URDFJoint().copy(joint);
                
                expect(clonedJoint.origPosition).toBeNull();
                expect(clonedJoint.origQuaternion).toBeNull();
            });

            it('should copy a joint correctly when origPosition and origQuaternion are defined', () => {
                const joint = new URDFJoint();
                joint.jointType = 'revolute';
                
                joint.setJointValue(1.0);
                
                const clonedJoint = new URDFJoint().copy(joint);
                
                expect(clonedJoint.origPosition).not.toBeNull();
                expect(clonedJoint.origQuaternion).not.toBeNull();
                expect(clonedJoint.origPosition!.equals(joint.origPosition!)).toBeTruthy();
            });
        });
    });

    // =========================================================================
    // SECTION: Class: URDFMimicJoint
    // =========================================================================
    describe('Class: URDFMimicJoint', () => {
        let joint: URDFJoint, mimickerA: URDFMimicJoint, mimickerB: URDFMimicJoint;

        beforeEach(() => {
            joint = new URDFJoint();
            joint.axis = new Vector3(0, 0, 1);
            joint.jointType = 'continuous';

            mimickerA = new URDFMimicJoint();
            mimickerA.axis = new Vector3(0, 0, 1);
            mimickerA.jointType = 'continuous';
            mimickerA.multiplier = 2;
            mimickerA.offset = 5;

            mimickerB = new URDFMimicJoint();
            mimickerB.axis = new Vector3(0, 0, 1);
            mimickerB.jointType = 'continuous';
            mimickerB.multiplier = -4;
            mimickerB.offset = -16;

            joint.mimicJoints = [mimickerA, mimickerB];
        });

        describe('updateFromMimickedJoint()', () => {
            it('should cascade positional values strictly according to multiplier and offset math', () => {
                joint.setJointValue(10);
                expect(mimickerA.jointValue).toEqual([25]);
                expect(mimickerB.jointValue).toEqual([-56]);
            });

            it('should return true when ALL joints within the tree register a change', () => {
                joint.jointValue = [0];
                mimickerA.jointValue = [0];
                mimickerB.jointValue = [0];
                expect(joint.setJointValue(10)).toBeTruthy();
            });

            it('should return false when NO joints within the tree register a change', () => {
                joint.jointValue = [10];
                mimickerA.jointValue = [25];
                mimickerB.jointValue = [-56];
                expect(joint.setJointValue(10)).toBeFalsy();
            });

            it('should handle string values gracefully through the mimic chain', () => {
                joint.setJointValue('10'); 
                expect(mimickerA.jointValue).toEqual([25]);
            });

            it('should safely ignore null values without mutating state', () => {
                const mimic = new URDFMimicJoint();
                mimic.jointType = 'revolute';
                expect(mimic.updateFromMimickedJoint(null)).toBe(false);
            });
        });
    });

    // =========================================================================
    // SECTION: Class: URDFRobot
    // =========================================================================
    describe('Class: URDFRobot', () => {

        describe('setJointValues() / setJointValue()', () => {
            it('should correctly set all joint angles using setJointValues', () => {
                const loader = new URDFLoader();
                const robot = loader.parse(`
                    <robot name="TEST">
                        <link name="LINK1"/><link name="LINK2"/><link name="LINK3"/>
                        <joint name="JOINT1" type="continuous"><axis xyz="0 0 -1" /><parent link="LINK1"/><child link="LINK2"/></joint>
                        <joint name="JOINT2" type="continuous"><axis xyz="0 0 -1" /><parent link="LINK2"/><child link="LINK3"/></joint>
                    </robot>
                `);

                expect(robot.setJointValues({ JOINT1: 1, JOINT2: 2 })).toBeTruthy();
                expect(robot.joints['JOINT1'].angle).toEqual(1);
                expect(robot.joints['JOINT2'].angle).toEqual(2);
            });

            it('should return false when trying to set a value for a non-existent joint', () => {
                const robot = new URDFRobot();
                expect(robot.setJointValue('GHOST_JOINT', 1.0)).toBeFalsy();
            });

            it('should correctly unpack arrays when using setJointValues for multi-DOF joints', () => {
                const robot = new URDFRobot();
                
                const planarJoint = new URDFJoint();
                planarJoint.name = 'PlanarJ';
                planarJoint.urdfName = 'PlanarJ';
                planarJoint.jointType = 'planar';
                
                robot.joints['PlanarJ'] = planarJoint;

                const didChange = robot.setJointValues({ 'PlanarJ': [1.5, -2.0, 3.14] });
                
                expect(didChange).toBeTruthy();
                expect(planarJoint.jointValue).toEqual([1.5, -2.0, 3.14]);
            });

            it('should correctly handle scalar (non-array) values in setJointValues', () => {
                const robot = new URDFRobot();
                
                const revoluteJoint = new URDFJoint();
                revoluteJoint.name = 'RevJ';
                revoluteJoint.urdfName = 'RevJ';
                revoluteJoint.jointType = 'revolute';
                revoluteJoint.ignoreLimits = true;
                
                robot.joints['RevJ'] = revoluteJoint;

                const didChange = robot.setJointValues({ 'RevJ': 2.5 });
                
                expect(didChange).toBeTruthy();
                expect(revoluteJoint.angle).toBe(2.5);
            });

            it('should evaluate the right side of the logical OR (|| didChange) when values do not change', () => {
                const robot = new URDFRobot();
                
                const planarJoint = new URDFJoint();
                planarJoint.name = 'PlanarJ';
                planarJoint.urdfName = 'PlanarJ';
                planarJoint.jointType = 'planar';
                
                const revJoint = new URDFJoint();
                revJoint.name = 'RevJ';
                revJoint.urdfName = 'RevJ';
                revJoint.jointType = 'revolute';
                
                robot.joints['PlanarJ'] = planarJoint;
                robot.joints['RevJ'] = revJoint;
                robot.setJointValues({ 'PlanarJ': [1.5, -2.0, 3.14], 'RevJ': 1.0 });
                
                const didChange = robot.setJointValues({ 'PlanarJ': [1.5, -2.0, 3.14], 'RevJ': 1.0 });
                
                expect(didChange).toBeFalsy();
            });
        });

        describe('updateMeshCaches()', () => {
            it('should eagerly compute bounding volumes and categorize flat meshes arrays', () => {
                const loader = new URDFLoader();
                loader.parseCollision = true;
                const robot = loader.parse(`
                    <robot name="CACHE_TEST">
                        <link name="LINK_A">
                            <visual name="VIS1"><geometry><box size="1 1 1"/></geometry></visual>
                            <collision name="COL1"><geometry><box size="1 1 1"/></geometry></collision>
                        </link>
                    </robot>
                `);

                robot.updateMeshCaches();

                expect(robot.flatVisualMeshes).toHaveLength(1);
                expect(robot.flatColliderMeshes).toHaveLength(1);

                const visualMesh = robot.flatVisualMeshes[0];
                expect(visualMesh.geometry.boundingBox).toBeDefined();
                expect(visualMesh.geometry.boundingSphere).toBeDefined();
            });

            it('should not recompute bounding volumes if they already exist', () => {
                const robot = new URDFRobot();
                const geometry = new BufferGeometry();

                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();
                
                const mesh = new Mesh(geometry, new MeshBasicMaterial());
                robot.add(mesh);
                
                const boxSpy = vi.spyOn(geometry, 'computeBoundingBox');
                const sphereSpy = vi.spyOn(geometry, 'computeBoundingSphere');
                
                robot.updateMeshCaches();
                
                expect(boxSpy).not.toHaveBeenCalled();
                expect(sphereSpy).not.toHaveBeenCalled();
            });

            it('should safely process meshes without geometry during cache updates', () => {
                const robot = new URDFRobot();
                const mesh = new Mesh();
                
                mesh.geometry = null as unknown as BufferGeometry;
                
                robot.add(mesh);
                
                expect(() => robot.updateMeshCaches()).not.toThrow();
                expect(robot.flatVisualMeshes).toHaveLength(1);
            });
        });

        describe('getFrame()', () => {
            it('should retrieve correct frames via getFrame() API', () => {
                const loader = new URDFLoader();
                const robot = loader.parse(`
                    <robot name="FRAME_TEST">
                        <link name="L1"/>
                        <link name="L2"/>
                        <joint name="J1"><parent link="L1"/><child link="L2"/></joint>
                    </robot>
                `);

                expect(robot.getFrame('L1')).toBeDefined();
                expect(robot.getFrame('L1')?.type).toBe('URDFLink');
                
                expect(robot.getFrame('J1')).toBeDefined();
                expect(robot.getFrame('J1')?.type).toBe('URDFJoint');
                
                expect(robot.getFrame('MISSING_FRAME')).toBeUndefined();
            });
        });

        describe('clone()', () => {
            it('should clone link and joint dictionaries accurately', () => {
                const loader = new URDFLoader();
                const res = loader.parse(`
                    <robot name="TEST">
                        <link name="LINK1"/><link name="LINK2"/>
                        <joint name="JOINT"><parent link="LINK1"/><child link="LINK2"/></joint>
                    </robot>
                `).clone();

                const names: string[] = [];
                res.traverse(c => names.push(c.name));
                expect(names).toEqual(['LINK1', 'JOINT', 'LINK2']);
                expect(Object.keys(res.links)).toEqual(['LINK1', 'LINK2']);
                expect(Object.keys(res.joints)).toEqual(['JOINT']);
                expect(Object.keys(res.frames)).toEqual(['LINK1', 'LINK2', 'JOINT']);
            });

            it('should include multiple colliders and visuals in the frame dictionary', () => {
                const loader = new URDFLoader();
                loader.parseCollision = true;
                const res = loader.parse(`
                    <robot name="TEST">
                        <link name="LINK1">
                            <visual name="BOX1_VISUAL"><box size="1 1 1"/></visual>
                            <collision name="BOX1_COLLISION"><box size="1 1 1"/></collision>
                        </link>
                        <link name="LINK2">
                            <visual name="BOX2_VISUAL"><box size="1 1 1"/></visual>
                            <collision name="BOX2_COLLISION"><box size="1 1 1"/></collision>
                        </link>
                        <joint name="JOINT"><parent link="LINK1"/><child link="LINK2"/></joint>
                    </robot>
                `).clone();

                expect(Object.keys(res.links)).toEqual(['LINK1', 'LINK2']);
                expect(Object.keys(res.joints)).toEqual(['JOINT']);
                expect(Object.keys(res.visual)).toEqual(['BOX1_VISUAL', 'BOX2_VISUAL']);
                expect(Object.keys(res.colliders)).toEqual(['BOX1_COLLISION', 'BOX2_COLLISION']);
                expect(Object.keys(res.frames).sort()).toEqual([
                    'BOX1_COLLISION', 'BOX2_COLLISION',
                    'BOX1_VISUAL', 'BOX2_VISUAL',
                    'LINK1', 'LINK2', 'JOINT'
                ].sort());
            });

            it('should clone mimic joints data without holding references to the original model', () => {
                const loader = new URDFLoader();
                const res = loader.parse(`
                    <robot name="TEST">
                        <link name="LINK1"/><link name="LINK2"/><link name="LINK3"/>
                        <joint name="A" type="continuous"><parent link="LINK1"/><child link="LINK2"/></joint>
                        <joint name="B" type="continuous">
                            <parent link="LINK2"/><child link="LINK3"/>
                            <mimic joint="A" offset="-5" multiplier="23"/>
                        </joint>
                    </robot>
                `);

                const cloned = res.clone();
                
                const jointB = cloned.joints['B'] as URDFMimicJoint;
                expect(jointB.mimicJoint).toEqual('A');
                expect(jointB.multiplier).toEqual(23);
                expect(jointB.offset).toEqual(-5);

                const jointA = cloned.joints['A'];
                expect(jointA.mimicJoints.length).toEqual(1);
                expect((jointA.mimicJoints[0] as URDFMimicJoint).name).toEqual('B');

                // References must point to the new instantiated cloned tree, not the old one
                expect(jointA.mimicJoints[0]).not.toBe(res.joints['A'].mimicJoints[0]);
            });

            it('should retain mesh resources correctly when cloning a robot', () => {
                const robot = new URDFRobot();
                const geometry = new BufferGeometry();
                const material = new MeshBasicMaterial();
                
                geometry.userData = { refCount: 1 };
                material.userData = { refCount: 1 };
                
                const mesh = new Mesh(geometry, material);
                robot.add(mesh);
                
                const clonedRobot = robot.clone();
                
                expect(clonedRobot).toBeDefined();
                expect(geometry.userData.refCount).toBe(2);
                expect(material.userData.refCount).toBe(2);
            });
        });

        describe('Structural Parsing & Topology Features', () => {
            it('should accurately parse joint efforts and velocities', () => {
                const loader = new URDFLoader();
                const robot = loader.parse(`
                    <robot name="TEST">
                        <link name="LINK1"/><link name="LINK2"/><link name="LINK3"/>
                        <joint name="JOINT1" type="continuous">
                            <axis xyz="0 0 -1" /><parent link="LINK1"/><child link="LINK2"/>
                            <limit effort="150" lower="-3.14" upper="3.14" velocity="5.20" />
                        </joint>
                        <joint name="JOINT2" type="continuous"><axis xyz="0 0 -1" /><parent link="LINK2"/><child link="LINK3"/></joint>
                    </robot>
                `);

                expect(robot.joints['JOINT1'].limit.effort).toEqual(150);
                expect(robot.joints['JOINT1'].limit.lower).toEqual(-3.14);
                expect(robot.joints['JOINT1'].limit.upper).toEqual(3.14);
                expect(robot.joints['JOINT1'].limit.velocity).toEqual(5.20);

                expect(robot.joints['JOINT2'].limit.effort).toEqual(0);
                expect(robot.joints['JOINT2'].limit.lower).toEqual(0);
                expect(robot.joints['JOINT2'].limit.upper).toEqual(0);
                expect(robot.joints['JOINT2'].limit.velocity).toEqual(0);
            });

            it('should correctly parse full inertial data and apply fallbacks', () => {
                const loader = new URDFLoader();
                const robot = loader.parse(`
                    <robot name="TEST">
                        <link name="LINK1">
                            <inertial>
                                <origin rpy="0 0 -1.5707963267948966" xyz="0.14635 0 0"/>
                                <mass value="2.5076"/>
                                <inertia ixx="0.00443333156" ixy="0.0" ixz="0.0" iyy="0.00443333156" iyz="0.0" izz="0.0072" />
                            </inertial>
                        </link>
                        <link name="LINK2"/><link name="LINK3"/>
                        <joint name="JOINT1" type="continuous"><parent link="LINK1"/><child link="LINK2"/></joint>
                        <joint name="JOINT2" type="continuous"><parent link="LINK2"/><child link="LINK3"/></joint>
                    </robot>
                `);

                expect(robot.links['LINK1'].inertial.origin.rpy).toEqual([0, 0, -1.5707963267948966]);
                expect(robot.links['LINK1'].inertial.origin.xyz).toEqual([0.14635, 0, 0]);
                expect(robot.links['LINK1'].inertial.mass).toEqual(2.5076);
                expect(robot.links['LINK1'].inertial.inertia.ixx).toEqual(0.00443333156);
                expect(robot.links['LINK1'].inertial.inertia.iyy).toEqual(0.00443333156);
                expect(robot.links['LINK1'].inertial.inertia.izz).toEqual(0.0072);
                
                // Cross-tensor verification
                expect(robot.links['LINK1'].inertial.inertia.ixy).toEqual(0);
                expect(robot.links['LINK1'].inertial.inertia.ixz).toEqual(0);
                expect(robot.links['LINK1'].inertial.inertia.iyz).toEqual(0);
                
                // Link 2 lacks the inertial tag, must default to zero vectors/matrices
                expect(robot.links['LINK2'].inertial.mass).toEqual(0);
                expect(robot.links['LINK2'].inertial.origin.xyz).toEqual([0, 0, 0]);
                expect(robot.links['LINK2'].inertial.origin.rpy).toEqual([0, 0, 0]);
                expect(robot.links['LINK2'].inertial.inertia.ixx).toEqual(0);
            });

            it('should register all node names when traversing the hierarchy', () => {
                const loader = new URDFLoader();
                const res = loader.parse(`
                    <robot name="TEST">
                        <link name="LINK1"/><link name="LINK2"/>
                        <joint name="JOINT"><parent link="LINK1"/><child link="LINK2"/></joint>
                    </robot>
                `);

                const names: string[] = [];
                res.traverse(c => names.push(c.name));
                expect(names).toEqual(['LINK1', 'JOINT', 'LINK2']);
            });
        });
    });
});