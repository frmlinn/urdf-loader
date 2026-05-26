import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import { URDFJoint, URDFMimicJoint } from '../../src/core/URDFClasses';

/**
 * Unit tests for the URDFJoint and URDFMimicJoint class mechanics.
 * Validates constraints, kinematic limitations, mimicking propagation, 
 * and boolean return signatures used for performance optimizations.
 */
describe('URDFJoint Kinematics & Limits', () => {
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
        joint.setJointValue(1.5); // Overshoot
        expect(joint.jointValue).toEqual([1]);
        joint.setJointValue(-1.5); // Undershoot
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

    describe('setJointValue (State Diff & Update Hooks)', () => {
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
            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(1.5)).toBeTruthy();
            expect(joint.matrixWorldNeedsUpdate).toBeTruthy();

            // Exceeding limit again (internally clipped to 1, effectively no change)
            joint.matrixWorldNeedsUpdate = false;
            expect(joint.setJointValue(1.5)).toBeFalsy();
            expect(joint.matrixWorldNeedsUpdate).toBeFalsy();

            // Repeat checks for prismatic linear behavior
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

    describe('Mimic Joints (Kinematic Chains & Trees)', () => {
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

        it('should return true when ONLY the master root joint registers a change', () => {
            joint.jointValue = [0];
            mimickerA.jointValue = [25];
            mimickerB.jointValue = [-56];
            expect(joint.setJointValue(10)).toBeTruthy();
        });

        it('should return true when AT LEAST ONE mimic leaf joint registers a change', () => {
            joint.jointValue = [10];
            mimickerA.jointValue = [0];
            mimickerB.jointValue = [-56];
            expect(joint.setJointValue(10)).toBeTruthy();
        });

        it('should return true when ALL mimic leaf joints register a change', () => {
            joint.jointValue = [10];
            mimickerA.jointValue = [0];
            mimickerB.jointValue = [0];
            expect(joint.setJointValue(10)).toBeTruthy();
        });
    });
});