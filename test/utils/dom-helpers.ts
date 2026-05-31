import { Material } from 'three';
import { URDFViewer } from '../../src/elements/URDFViewer';

/**
 * Interface exposing private internal properties of URDFViewer for testing purposes.
 */
export interface ViewerPrivates {
    _collisionMaterial: Material;
    _shadowsNeedUpdate: boolean;
    _setIgnoreLimits: (ignore: boolean, dispatch?: boolean) => void;
    _updateShadowBounds: (force?: boolean) => void;
    _renderLoop: () => void;
    _dirty: boolean;
    _loadUrdf: (pkg: string, urdf: string) => void;
    _scheduleLoad: () => void;
}

/**
 * Safely accesses private properties without triggering TypeScript's `never` overlap.
 * @param v - The URDFViewer instance to extract privates from.
 * @returns The viewer casted to expose its private internal API.
 */
export const getPrivates = (v: URDFViewer): ViewerPrivates => v as unknown as ViewerPrivates;