import { vi } from 'vitest';

/**
 * Mocks the ResizeObserver globally as jsdom lacks native support. 
 */
global.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
} as unknown as typeof ResizeObserver;

/**
 * Mocks THREE.WebGLRenderer to bypass WebGL context requirements in the jsdom environment.
 * Includes basic pointer capture support for testing DOM interactions.
 */
vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three')>();
    class MockWebGLRenderer {
        domElement = document.createElement('canvas');
        shadowMap = { enabled: false, type: 0 };
        outputColorSpace = '';
        
        constructor() {
            // JSDOM lacks native PointerCapture support; mocking it on the canvas element
            this.domElement.setPointerCapture = vi.fn();
            this.domElement.releasePointerCapture = vi.fn();
            this.domElement.getBoundingClientRect = () => ({ 
                left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {} 
            } as DOMRect);
        }

        setClearColor = vi.fn();
        getSize = vi.fn().mockReturnValue(new actual.Vector2(0, 0));
        setPixelRatio = vi.fn();
        setSize = vi.fn();
        render = vi.fn();
        compile = vi.fn();
        dispose = vi.fn();
    }
    return { ...actual, WebGLRenderer: MockWebGLRenderer };
});