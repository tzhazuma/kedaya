# React Bits adaptations for the miniapp

Upstream: https://github.com/DavidHDev/react-bits

Reference revision: `310fc737fadcaa149a4e06fb088fc95332dc8bfb`.

Selected sources were read from the official registry:

- https://reactbits.dev/r/SpotlightCard-TS-CSS.json
- https://reactbits.dev/r/GlareHover-TS-CSS.json
- https://reactbits.dev/r/AnimatedContent-TS-CSS.json
- https://reactbits.dev/r/Dock-TS-CSS.json

`SpotlightCard` ports the layered radial spotlight, local pointer coordinates,
clamping, presence fade and glare band to Taro `View`, touch events and WXSS.
Bounds are queried once per gesture; visual updates are limited to about 30fps.
Touch handling does not cancel native page scrolling.

`AnimatedContent` adapts the mount-triggered opacity/slide/stagger effect to
native WXSS keyframes. Content stays visible when animations are unsupported.
The GSAP scroll timeline and browser-only effects are not included.

`../KdyDock` now follows the user's hand drawn navigation reference, with native
press feedback and a central creation action. Desktop cursor proximity, browser
portals and context menus are not part of this miniapp component.

These are source adaptations, not an unmodified React Bits package installation.
They do not require browser DOM, React DOM 19, GSAP, WebGL or continuous animation
loops. The original notice is retained in `LICENSE.react-bits.md`.
