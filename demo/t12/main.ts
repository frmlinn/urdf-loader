import { MathUtils } from 'three';
import '../../src/elements/URDFManipulator';
import type { URDFManipulator } from '../../src/elements/URDFManipulator';

const viewer = document.getElementById('viewer') as URDFManipulator;
const toggleAnim = document.getElementById('toggle-anim') as HTMLInputElement;

let isAnimating = true;

/**
 * Binds UI interactions to the URDF viewer properties and animation state.
 */
function setupEvents(): void {
    toggleAnim.addEventListener('change', (e) => isAnimating = (e.target as HTMLInputElement).checked);
    
    document.getElementById('toggle-limits')!.addEventListener('change', (e) => {
        viewer.ignoreLimits = (e.target as HTMLInputElement).checked;
    });

    document.getElementById('toggle-autocenter')!.addEventListener('change', (e) => {
        viewer.noAutoRecenter = !(e.target as HTMLInputElement).checked;
    });

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
 * Injects sine-wave based locomotion into the T12 athlete's joints.
 * * @param time - High resolution timestamp provided by requestAnimationFrame.
 */
function animationLoop(time: number): void {
    requestAnimationFrame(animationLoop);

    if (!isAnimating || !viewer.robot) return;

    // Scale down high-precision milliseconds to a smooth speed factor
    const timeScaled = time / 300;

    // Animate the 6 legs
    for (let i = 1; i <= 6; i++) {
        const offset = (i * Math.PI) / 3;
        const ratio = Math.max(0, Math.sin(timeScaled + offset));

        viewer.setJointValue(`HP${i}`, MathUtils.lerp(30, 0, ratio) * MathUtils.DEG2RAD);
        viewer.setJointValue(`KP${i}`, MathUtils.lerp(90, 150, ratio) * MathUtils.DEG2RAD);
        viewer.setJointValue(`AP${i}`, MathUtils.lerp(-30, -60, ratio) * MathUtils.DEG2RAD);

        viewer.setJointValue(`TC${i}A`, MathUtils.lerp(0, 0.065, ratio));
        viewer.setJointValue(`TC${i}B`, MathUtils.lerp(0, 0.065, ratio));
        
        // Continuous wheel rotation
        viewer.setJointValue(`W${i}`, timeScaled); 
    }
}

// Initialization
setupEvents();
requestAnimationFrame(animationLoop);