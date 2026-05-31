import { describe, it, expect } from 'vitest';
import { Mesh, BufferGeometry, MeshBasicMaterial } from 'three';
import { URDFLoader } from '../../src/core/URDFLoader';
import { URDFRobot, URDFJoint, URDFMimicJoint } from '../../src/core/URDFClasses';

/**
 * Unit tests for the URDFRobot class.
 * Ensures proper joint evaluation, limit parsing, inertial data extraction,
 * and structural cloning of the robot's topological graph.
 */
describe('URDFRobot', () => {
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
});

describe('Mesh Caching and Frame Retrieval', () => {
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

describe('Cloning and Resource Management', () => {
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

describe('State Management and Updates', () => {
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