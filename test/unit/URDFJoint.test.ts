import { describe, it, expect } from 'vitest';
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
        joint.setJointValue(1.5);
        expect(joint.jointValue).toEqual([1.5]);
    });

    it('debería ignorar los límites cuando ignoreLimits es true', () => {
        const joint = new URDFJoint();
        joint.limit.upper = 1;
        joint.limit.lower = -1;
        joint.ignoreLimits = true;
        joint.axis = new Vector3(0, 0, 1);

        joint.jointType = 'revolute';
        joint.setJointValue(1.5);
        expect(joint.jointValue).toEqual([1.5]);
        
        joint.jointType = 'prismatic';
        joint.setJointValue(-1.5);
        expect(joint.jointValue).toEqual([-1.5]);
    });

    describe('setJointValue (Retornos de actualización)', () => {
        it('debería retornar true solo si el valor realmente cambió', () => {
            const joint = new URDFJoint();
            joint.limit.upper = 1;
            joint.limit.lower = -1;
            joint.axis = new Vector3(0, 0, 1);

            joint.jointType = 'revolute';
            joint.matrixWorldNeedsUpdate = false;
            
            expect(joint.setJointValue(0.5)).toBeTruthy();
            expect(joint.matrixWorldNeedsUpdate).toBeTruthy();

            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(0.5)).toBeFalsy();
            expect(joint.matrixWorldNeedsUpdate).toBeFalsy();
        });
    });

    describe('setJointValue con Mimic Joints', () => {
        const joint = new URDFJoint();
        joint.axis = new Vector3(0, 0, 1);
        joint.jointType = 'continuous';

        const mimickerA = new URDFMimicJoint();
        mimickerA.axis = new Vector3(0, 0, 1);
        mimickerA.jointType = 'continuous';
        mimickerA.multiplier = 2;
        mimickerA.offset = 5;

        const mimickerB = new URDFMimicJoint();
        mimickerB.axis = new Vector3(0, 0, 1);
        mimickerB.jointType = 'continuous';
        mimickerB.multiplier = -4;
        mimickerB.offset = -16;

        joint.mimicJoints = [mimickerA, mimickerB];

        it('debería propagar los valores a los mimic joints', () => {
            joint.setJointValue(10);
            expect(mimickerA.jointValue).toEqual([25]);
            expect(mimickerB.jointValue).toEqual([-56]);
        });

        it('debería retornar true si algún joint (padre o mimic) se actualiza', () => {
            joint.jointValue = [0];
            mimickerA.jointValue = [0];
            mimickerB.jointValue = [0];
            expect(joint.setJointValue(10)).toBeTruthy();
        });

        it('debería retornar false cuando ningún joint se actualiza', () => {
            joint.jointValue = [10];
            mimickerA.jointValue = [25];
            mimickerB.jointValue = [-56];
            expect(joint.setJointValue(10)).toBeFalsy();
        });
    });
});