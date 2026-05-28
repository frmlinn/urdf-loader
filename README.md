# urdf-loader

[![CI Tests](https://img.shields.io/github/actions/workflow/status/frmlinn/urdf-loader/ci-test.yml?label=CI%20Tests)](https://github.com/frmlinn/urdf-loader/actions/workflows/ci-test.yml)
[![GitHub Pages Deploy](https://img.shields.io/github/actions/workflow/status/frmlinn/urdf-loader/deploy.yml?label=GitHub%20Pages%20Deploy)](https://frmlinn.github.io/urdf-loader/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Language](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)

Library for loading, parsing, and visualizing URDF (Unified Robot Description Format) models in the browser using Three.js.

> [!NOTE]
> This library is a complete from-scratch rewrite focused on memory stability and performance optimization in continuous rendering environments and simulations. The original project can be found here: [urdf-loaders](https://github.com/gkjohnson/urdf-loaders)

## Core Capabilities

* **Memory Management and Zero-GC Architecture**: Implements a Reference Counting system tailored to the lifecycle of meshes, geometries, and materials in Three.js. This guarantees the proper release and destruction of resources in the GPU when a model or link is removed from the scene, preventing critical memory leaks. Additionally, kinematic update functions rely on pre-allocated mathematical objects at the module level, completely eliminating the instantiation of temporary objects in rendering loops and avoiding Garbage Collector pauses.
* **Linear and Optimized Spatial Calculation**: The loader's core replaces traditional recursive traversals over the robot's transformation tree with flat caches (one-dimensional arrays) for visual and collision meshes. Spatial bounds calculation is executed through a hybrid heuristic combining Bounding Boxes and Bounding Spheres. This drastically reduces mathematical complexity and CPU load during camera recentering operations, selective raycasting, and dynamic ground plane adjustment.
* **Encapsulated Web Component (Shadow DOM)**: Natively provides the `<urdf-viewer>` custom element. By isolating the interactive canvas, initialization logic, and aesthetic definitions within a *Shadow DOM*, any conflict or CSS style bleeding with the main document is prevented. This ensures total technological independence and direct compatibility when integrated into modern framework-based applications or pure HTML.
* **Shadow System with Hysteresis**: The viewer optimizes graphic performance by applying a hysteresis algorithm with a 15% tolerance margin over the robot's shadow volume. The orthographic camera's frustum and the directional light's position are only recalculated if the model's kinematic movements exceed this clearance threshold, reducing redundant shadow map updates and freeing up GPU resources.
* **Advanced Kinematics and Compatibility**: Enables full reading of joint and dynamic constraints, offering strict support for *fixed*, *continuous*, *revolute*, *prismatic*, *planar*, and *floating* joints. It includes a processor for the `<mimic>` tag, capable of applying numerical multipliers and offsets by predictively calculating transformations to avoid infinite recursion loops.

## Installation

Via package manager:

```bash
npm install @frmlinn/urdf-loader three
```

### Basic Usage
The library exposes two main integration methods: via a standalone Web Component aimed at quick HTML declarations, or through programmatic use of the `URDFLoader` class for existing Three.js pipelines.

- **Web Component** (`URDF Viewer`)

This is the most straightforward method to render a robot in the browser. Upon importing the package, the element is automatically registered in the DOM and internally handles the instantiation of its own scene, lights, renderer, and orbit controls.

```HTML
<script type="module">
  // Imports the component and automatically registers it in your environment
  import '@frmlinn/urdf-loader';
</script>

<urdf-viewer 
  urdf="path/to/your/model.urdf" 
  package="path/to/packages/directory/">
</urdf-viewer>
```

- **Reactive properties**:

This version adds advanced reactive attributes to natively manage kinematic behaviors, physical rendering, and camera optimizations directly from the HTML tags.

```HTML
<urdf-viewer 
  urdf="path/to/your/model.urdf" 
  package="path/to/packages/directory/"
  up="+Z" 
  display-shadow 
  show-collision
  ignore-limits
  auto-redraw
  no-auto-recenter
  ambient-color="#8ea0a8">
</urdf-viewer>
```

- **Programatic Usage (`URDF Loader`)**

For complex applications or robotic simulations where you already have an active canvas and a Three.js instance, you should interact directly with the `URDFLoader` class.

Through the `loadMeshFunc` property, you can inject a custom asynchronous handler. This allows you to delegate the parsing of specific 3D mesh formats (such as compressed .glb or .gltf files) using external modules without altering the library's internal bundling.

```js
import { LoadingManager } from 'three';
import { URDFLoader } from '@frmlinn/urdf-loader';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const manager = new LoadingManager();
const loader = new URDFLoader(manager);

// Mapping for internal path resolution based on the "package://" protocol
loader.packages = {
  myRobotPackage: './local/path/to/package/'
};

// Injecting a custom loader to support GLTF/GLB geometry formats
loader.loadMeshFunc = (path, mgr) => {
  return new Promise((resolve, reject) => {
    const gltfLoader = new GLTFLoader(mgr);
    gltfLoader.load(
      path,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => reject(err)
    );
  });
};

// NOTE: Replace this generic path with the location of your URDF descriptor.
// If you don't have a model on hand, you can download the files corresponding
// to the test robots (T12 or MHS) directly from the /urdf directory of this repository.
loader.load('path/to/your/model.urdf', (robot) => {
  // The returned object inherits from THREE.Object3D and is ready to be added to the scene
  scene.add(robot);
});
```

## Demos
The repository includes two live examples showcasing the viewer's capabilities:

- [**NASA ATHLETE T12 Demo**](https://frmlinn.github.io/urdf-loader/t12/)  
  Illustrates a classic high-degree-of-freedom kinematic chain using standalone binary STL meshes. It showcases real-time joint limit constraints and camera auto-centering telemetry under heavy parallel movement.

- [**NASA MHS Helicopter Demo**](https://frmlinn.github.io/urdf-loader/mhs/)  
  Demonstrates complex mesh handling by overriding the architecture with custom `loadMeshFunc` implementation. The viewer delegates the parsing, pre-allocation, and structural shadow mapping optimization of heavy binary GLTF (GLB) assemblies

## Acknowledgments
This project is a deep architectural reconstruction and iteration based on the excellent original work in the `urdf-loaders` library. Out of respect for the original maintainers and their initial effort, they are credited with the corresponding copyrights, and the Apache 2.0 license under which they published their codebase remains unaltered.

Additionally, the 3D models used in the public examples and demonstrations come from open-source repositories generously provided by NASA and the Jet Propulsion Laboratory.

## License
This software is available under the Apache V2.0 license.

Copyright © 2020 California Institute of Technology. ALL RIGHTS RESERVED. United States Government Sponsorship Acknowledged. Neither the name of Caltech nor its operating division, the Jet Propulsion Laboratory, nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.