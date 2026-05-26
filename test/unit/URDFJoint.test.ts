import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import { URDFJoint, URDFMimicJoint } from '../../src/core/URDFClasses';

describe('URDFJoint', () => {
    it('debería tener el eje por defecto correcto', () => {
        const joint1 = new URDFJoint();
        expect(joint1.axis.equals(new Vector3(1, 0, 0))).toBeTruthy();

        joint1.axis.x = 2;
        const joint2 = new URDFJoint().copy(joint1);
        joint1.axis.x = 3;
        expect(joint1.axis.equals(new Vector3(3, 0, 0))).toBeTruthy();
        expect(joint2.axis.equals(new Vector3(2, 0, 0))).toBeTruthy();
    });

    it('debería establecer el array jointValues basado en el tipo', () => {
        const joint = new URDFJoint();
        const types = ['revolute', 'prismatic', 'continuous', 'planar', 'floating', 'fixed'] as const;
        const lengths = [1, 1, 1, 3, 6, 0];

        types.forEach((type, index) => {
            joint.jointType = type;
            expect(joint.jointValue).toHaveLength(lengths[index]);
        });
    });

    it('debería respetar los límites superior e inferior', () => {
        const joint = new URDFJoint();
        joint.limit.upper = 1;
        joint.limit.lower = -1;
        joint.axis = new Vector3(0, 0, 1);

        joint.jointType = 'revolute';
        joint.setJointValue(0.5);
        expect(joint.jointValue).toEqual([0.5]);
        joint.setJointValue(1.5);
        expect(joint.jointValue).toEqual([1]);
        joint.setJointValue(-1.5);
        expect(joint.jointValue).toEqual([-1]);

        joint.jointType = 'prismatic';
        joint.setJointValue(0.5);
        expect(joint.jointValue).toEqual([0.5]);
        joint.setJointValue(1.5);
        expect(joint.jointValue).toEqual([1]);
        joint.setJointValue(-1.5);
        expect(joint.jointValue).toEqual([-1]);

        // continuous no usa límites
        joint.jointType = 'continuous';
        joint.setJointValue(0.5);
        expect(joint.jointValue).toEqual([0.5]);
        joint.setJointValue(1.5);
        expect(joint.jointValue).toEqual([1.5]);
        joint.setJointValue(-1.5);
        expect(joint.jointValue).toEqual([-1.5]);
    });

    it('debería ignorar los límites cuando ignoreLimits es true', () => {
        const joint = new URDFJoint();
        joint.limit.upper = 1;
        joint.limit.lower = -1;
        joint.ignoreLimits = true;
        joint.axis = new Vector3(0, 0, 1);

        joint.jointType = 'revolute';
        joint.setJointValue(0.5);
        expect(joint.jointValue).toEqual([0.5]);
        joint.setJointValue(1.5);
        expect(joint.jointValue).toEqual([1.5]);
        joint.setJointValue(-1.5);
        expect(joint.jointValue).toEqual([-1.5]);
        
        joint.jointType = 'prismatic';
        joint.setJointValue(0.5);
        expect(joint.jointValue).toEqual([0.5]);
        joint.setJointValue(1.5);
        expect(joint.jointValue).toEqual([1.5]);
        joint.setJointValue(-1.5);
        expect(joint.jointValue).toEqual([-1.5]);
    });

    describe('setJointValue (Retornos de actualización)', () => {
        it('debería retornar true solo si el valor de la articulación realmente cambió', () => {
            const joint = new URDFJoint();
            joint.limit.upper = 1;
            joint.limit.lower = -1;
            joint.axis = new Vector3(0, 0, 1);

            joint.jointType = 'revolute';
            joint.matrixWorldNeedsUpdate = false;
            
            // Primer cambio válido
            expect(joint.setJointValue(0.5)).toBeTruthy();
            expect(joint.matrixWorldNeedsUpdate).toBeTruthy();

            // Mismo valor, sin cambios
            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(0.5)).toBeFalsy();
            expect(joint.matrixWorldNeedsUpdate).toBeFalsy();

            // Al límite superior (cambio válido)
            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(1.5)).toBeTruthy();
            expect(joint.matrixWorldNeedsUpdate).toBeTruthy();

            // Excediendo el límite superior otra vez (clipeado a 1, sin cambios)
            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(1.5)).toBeFalsy();
            expect(joint.matrixWorldNeedsUpdate).toBeFalsy();

            // Misma comprobación pero para prismática
            joint.jointType = 'prismatic';
            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(0.5)).toBeTruthy();
            expect(joint.matrixWorldNeedsUpdate).toBeTruthy();

            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(0.5)).toBeFalsy();
            expect(joint.matrixWorldNeedsUpdate).toBeFalsy();

            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(1.5)).toBeTruthy();
            expect(joint.matrixWorldNeedsUpdate).toBeTruthy();

            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(1.5)).toBeFalsy();
            expect(joint.matrixWorldNeedsUpdate).toBeFalsy();
        });
    });

    describe('setJointValue con Mimic Joints', () => {
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

        it('debería propagar los valores a los mimic joints', () => {
            joint.setJointValue(10);
            expect(mimickerA.jointValue).toEqual([25]);
            expect(mimickerB.jointValue).toEqual([-56]);
        });

        it('debería retornar true cuando TODAS las articulaciones se actualizan', () => {
            joint.jointValue = [0];
            mimickerA.jointValue = [0];
            mimickerB.jointValue = [0];
            expect(joint.setJointValue(10)).toBeTruthy();
        });

        it('debería retornar false cuando NINGUNA articulación se actualiza', () => {
            joint.jointValue = [10];
            mimickerA.jointValue = [25];
            mimickerB.jointValue = [-56];
            expect(joint.setJointValue(10)).toBeFalsy();
        });

        it('debería retornar true cuando SOLO la articulación maestra se actualiza', () => {
            joint.jointValue = [0];
            mimickerA.jointValue = [25];
            mimickerB.jointValue = [-56];
            expect(joint.setJointValue(10)).toBeTruthy();
        });

        it('debería retornar true cuando UN mimic joint se actualiza', () => {
            joint.jointValue = [10];
            mimickerA.jointValue = [0];
            mimickerB.jointValue = [-56];
            expect(joint.setJointValue(10)).toBeTruthy();
        });

        it('debería retornar true cuando TODOS los mimic joints se actualizan', () => {
            joint.jointValue = [10];
            mimickerA.jointValue = [0];
            mimickerB.jointValue = [0];
            expect(joint.setJointValue(10)).toBeTruthy();
        });
    });
});