import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import { URDFJoint, URDFMimicJoint } from '../../src/core/URDFClasses';

/**
 * Unit tests for the URDFJoint and URDFMimicJoint classes.
 * Validates constraints, kinematic limitations, mimic propagation, 
 * and boolean return signatures used for rendering optimizations.
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

    describe('State Differencing & Defensive Branches', () => {
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

            const mimic = new URDFMimicJoint();
            mimic.jointType = 'revolute';
            expect(mimic.updateFromMimickedJoint(null)).toBe(false);
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
    });

    describe('Mimic Joints (Kinematic Chains)', () => {
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

        it('should handle string values gracefully through the mimic chain', () => {
            joint.setJointValue('10'); 
            expect(mimickerA.jointValue).toEqual([25]);
        });
    });
    
    describe('Complex Kinematics (Planar & Floating)', () => {
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
    });

    describe('Uninitialized State Copying', () => {
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

    describe('String Value Parsing in setJointValue', () => {
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

        it('should correctly parse string values for planar joints', () => {
            const joint = new URDFJoint();
            joint.jointType = 'planar';
            
            joint.setJointValue('1.5', '-2.0', '3.14');
            expect(joint.jointValue).toEqual([1.5, -2.0, 3.14]);
        });

        it('should correctly parse string values for floating joints', () => {
            const joint = new URDFJoint();
            joint.jointType = 'floating';
            
            joint.setJointValue('1', '2', '3', '4', '5', '6');
            expect(joint.jointValue).toEqual([1, 2, 3, 4, 5, 6]);
        });
    });
});