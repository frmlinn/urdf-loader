import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import '../../src/elements/URDFManipulator';
import type { URDFManipulator } from '../../src/elements/URDFManipulator';

const viewer = document.getElementById('viewer') as URDFManipulator;
const toggleAnim = document.getElementById('toggle-anim') as HTMLInputElement;

let isAnimating = true;

// Inyectamos el GLTFLoader explícitamente solo en esta demo
viewer.loadMeshFunc = async (path: string, manager: THREE.LoadingManager) => {
    return new Promise((resolve, reject) => {
        new GLTFLoader(manager).load(
            path,
            (gltf) => {
                // SOLUCIÓN: Recorremos la jerarquía del GLTF una única vez al cargar
                // para habilitar las sombras en todas las mallas internas.
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
                reject(new Error(`Fallo cargando GLTF: ${msg}`));
            }
        );
    });
};

function setupEvents() {
    toggleAnim.addEventListener('change', (e) => isAnimating = (e.target as HTMLInputElement).checked);
    viewer.addEventListener('manipulate-start', () => {
        if (isAnimating) {
            isAnimating = false;
            toggleAnim.checked = false;
        }
    });
}

function animationLoop(time: number) {
    requestAnimationFrame(animationLoop);

    if (!isAnimating || !viewer.robot) return;

    // Escala del tiempo inyectado por requestAnimationFrame
    const rotTime = time * 0.005;

    for (const jointName in viewer.robot.joints) {
        const joint = viewer.robot.joints[jointName];
        
        // Rotación de rotores/hélices
        if (joint.jointType === 'continuous' || jointName.toLowerCase().includes('blade')) {
            const dir = jointName.toLowerCase().includes('bottom') ? -1 : 1;
            viewer.setJointValue(jointName, rotTime * dir);
        }
    }
}

setupEvents();
requestAnimationFrame(animationLoop);