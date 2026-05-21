import { describe, it, expect } from 'vitest';
import { URDFLoader } from '../../src/core/URDFLoader';
import { URDFMimicJoint } from '../../src/core/URDFClasses';

describe('URDFRobot', () => {
    it('debería establecer correctamente todos los ángulos de las articulaciones', () => {
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

    it('debería parsear los esfuerzos y velocidades de las articulaciones', () => {
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

    it('debería parsear correctamente la data inercial', () => {
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
        
        // El link 2 no tiene tag inertial, debe tener los valores por defecto
        expect(robot.links['LINK2'].inertial.mass).toEqual(0);
        expect(robot.links['LINK2'].inertial.origin.xyz).toEqual([0, 0, 0]);
    });

    it('debería registrar el nombre de los nodos (traverse name map)', () => {
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

    it('debería clonar los diccionarios de links y joints correctamente', () => {
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

    it('debería incluir colisiones y visuales en el diccionario de nombres de frames', () => {
        const loader = new URDFLoader();
        loader.parseCollision = true;
        const res = loader.parse(`
            <robot name="TEST">
                <link name="LINK1">
                    <visual name="BOX1_VISUAL"><box size="1 1 1"/></visual>
                    <collision name="BOX1_COLLISION"><box size="1 1 1"/></collision>
                </link>
                <link name="LINK2"/>
                <joint name="JOINT"><parent link="LINK1"/><child link="LINK2"/></joint>
            </robot>
        `).clone();

        expect(Object.keys(res.visual)).toEqual(['BOX1_VISUAL']);
        expect(Object.keys(res.colliders)).toEqual(['BOX1_COLLISION']);
        expect(Object.keys(res.frames).sort()).toEqual([
            'BOX1_COLLISION', 'BOX1_VISUAL', 'LINK1', 'LINK2', 'JOINT'
        ].sort());
    });

    it('debería clonar los datos de las articulaciones mímicas sin referenciar al modelo original', () => {
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
        
        // Casting explícito a URDFMimicJoint para acceder a sus propiedades
        const jointB = cloned.joints['B'] as URDFMimicJoint;
        expect(jointB.mimicJoint).toEqual('A');
        expect(jointB.multiplier).toEqual(23);
        expect(jointB.offset).toEqual(-5);

        const jointA = cloned.joints['A'];
        expect(jointA.mimicJoints.length).toEqual(1);
        expect((jointA.mimicJoints[0] as URDFMimicJoint).name).toEqual('B');

        // FUNDAMENTAL: Las referencias no deben apuntar a la instancia del robot viejo
        expect(jointA.mimicJoints[0]).not.toBe(res.joints['A'].mimicJoints[0]);
    });
});