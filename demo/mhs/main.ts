import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import '../../src/elements/URDFManipulator';
import type { URDFManipulator } from '../../src/elements/URDFManipulator';

const viewer = document.getElementById('viewer') as URDFManipulator;
const toggleAnim = document.getElementById('toggle-anim') as HTMLInputElement;

let isAnimating = true;

/**
 * Inject custom GLTFLoader hook specifically for this demo to handle 
 * the modern .gltf/.glb files used by the MHS Helicopter.
 */
viewer.loadMeshFunc = async (path: string, manager: THREE.LoadingManager): Promise<THREE.Object3D> => {
    return new Promise((resolve, reject) => {
        new GLTFLoader(manager).load(
            path,
            (gltf) => {
                // Eager evaluation: Traverse GLTF hierarchy once to enable shadows on all inner meshes
                gltf.scene.traverse((node) => {
                    if (node instanceof THREE.Mesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });
                
                resolve(gltf.scene);
            },
            undefined,
            (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                reject(new Error(`GLTF Load Failure: ${msg}`));
            }
        );
    });
};

/**
 * Binds UI interactions to the URDF viewer properties and animation state.
 */
function setupEvents(): void {
    toggleAnim.addEventListener('change', (e) => isAnimating = (e.target as HTMLInputElement).checked);
    
    // Pause animation automatically when the user grabs a joint
    viewer.addEventListener('manipulate-start', () => {
        if (isAnimating) {
            isAnimating = false;
            toggleAnim.checked = false;
        }
    });
}

/**
 * Main render and animation loop. 
 * Spins the helicopter rotors continuously based on time.
 * * @param time - High resolution timestamp provided by requestAnimationFrame.
 */
function animationLoop(time: number): void {
    requestAnimationFrame(animationLoop);

    if (!isAnimating || !viewer.robot) return;

    // Time scaling injected by requestAnimationFrame
    const rotTime = time * 0.005;

    for (const jointName in viewer.robot.joints) {
        const joint = viewer.robot.joints[jointName];
        
        // Spin logic for rotors/blades
        if (joint.jointType === 'continuous' || jointName.toLowerCase().includes('blade')) {
            const dir = jointName.toLowerCase().includes('bottom') ? -1 : 1;
            viewer.setJointValue(jointName, rotTime * dir);
        }
    }
}

// Initialization
setupEvents();
requestAnimationFrame(animationLoop);