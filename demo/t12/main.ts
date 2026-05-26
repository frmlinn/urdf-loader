import * as THREE from 'three';
// Importamos subiendo dos niveles hasta 'src'
import '../../src/elements/URDFManipulator';
import type { URDFManipulator } from '../../src/elements/URDFManipulator';

const viewer = document.getElementById('viewer') as URDFManipulator;
const toggleAnim = document.getElementById('toggle-anim') as HTMLInputElement;

let isAnimating = true;

// 1. Configuración de Eventos UI
function setupEvents() {
    toggleAnim.addEventListener('change', (e) => isAnimating = (e.target as HTMLInputElement).checked);
    
    document.getElementById('toggle-limits')!.addEventListener('change', (e) => {
        viewer.ignoreLimits = (e.target as HTMLInputElement).checked;
    });

    document.getElementById('toggle-autocenter')!.addEventListener('change', (e) => {
        viewer.noAutoRecenter = !(e.target as HTMLInputElement).checked;
    });

    viewer.addEventListener('manipulate-start', () => {
        if (isAnimating) {
            isAnimating = false;
            toggleAnim.checked = false;
        }
    });
}

// 2. Bucle de Animación usando DOMHighResTimeStamp
function animationLoop(time: number) {
    requestAnimationFrame(animationLoop);

    if (!isAnimating || !viewer.robot) return;

    // 'time' viene en milisegundos de altísima precisión
    const timeScaled = time / 300;

    for (let i = 1; i <= 6; i++) {
        const offset = (i * Math.PI) / 3;
        const ratio = Math.max(0, Math.sin(timeScaled + offset));

        viewer.setJointValue(`HP${i}`, THREE.MathUtils.lerp(30, 0, ratio) * THREE.MathUtils.DEG2RAD);
        viewer.setJointValue(`KP${i}`, THREE.MathUtils.lerp(90, 150, ratio) * THREE.MathUtils.DEG2RAD);
        viewer.setJointValue(`AP${i}`, THREE.MathUtils.lerp(-30, -60, ratio) * THREE.MathUtils.DEG2RAD);

        viewer.setJointValue(`TC${i}A`, THREE.MathUtils.lerp(0, 0.065, ratio));
        viewer.setJointValue(`TC${i}B`, THREE.MathUtils.lerp(0, 0.065, ratio));
        viewer.setJointValue(`W${i}`, timeScaled); // Ruedas girando continuas
    }
}

// Inicialización
setupEvents();
requestAnimationFrame(animationLoop);