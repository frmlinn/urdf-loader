import { vi, expect } from 'vitest';
import { Mesh, Object3D } from 'three';
import { URDFRobot, URDFMimicJoint } from '../../src/core/URDFClasses';

/**
 * Flushes the microtask queue to process pending Promises safely.
 * Prevents event loop starvation in async tests without relying on arbitrary timeouts.
 */
export const flushPromises = () => new Promise(resolve => process.nextTick(resolve));

/**
 * Triggers the debounced requestAnimationFrame to process URL changes
 * and waits for the internal promises of URDFLoader to resolve.
 */
export const waitForLoad = async () => {
    vi.advanceTimersByTime(16); // Advance 1 frame (16ms) to trigger RAF
    await flushPromises();      // Resolve loadAsync promises
};

/**
 * Mocks an asynchronous mesh loading operation.
 * @returns A promise resolving to an empty Three.js Object3D.
 */
export async function emptyLoadMeshFunc(): Promise<Object3D> {
    const mesh = new Mesh();
    Object.defineProperty(mesh, 'fromCallback', { value: true, writable: false });
    return mesh;
}

/** Node representation for deep URDF topological comparisons. */
export type CompareNode = Omit<URDFRobot, 'setJointValue' | 'setJointValues'> & 
                   Omit<URDFMimicJoint, 'setJointValue'> & {
    isMesh?: boolean;
    isURDFLink?: boolean;
    isURDFRobot?: boolean;
    isURDFJoint?: boolean;
    isURDFCollider?: boolean;
};

/**
 * Recursively asserts deep structural and property equality between two URDF structures.
 * @param ra - The reference URDF node.
 * @param rb - The target URDF node to compare against.
 */
export function compareRobots(ra: unknown, rb: unknown): void {
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