/* UzoneQuiz — Aurora WebGL2 Background
   Ported from React Bits <Aurora /> to vanilla JS. Zero dependencies. */
(() => {
  'use strict';

  const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ),
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \\
  int index = 0;                                            \\
  for (int i = 0; i < 2; i++) {                               \\
     ColorStop currentColor = colors[i];                    \\
     bool isInBetween = currentColor.position <= factor;    \\
     index = int(mix(float(index), float(i), float(isInBetween))); \\
  }                                                         \\
  ColorStop currentColor = colors[index];                   \\
  ColorStop nextColor = colors[index + 1];                  \\
  float range = nextColor.position - currentColor.position; \\
  float lerpFactor = (factor - currentColor.position) / range; \\
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \\
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}`;

  /* ── Hex → [r, g, b] normalised ── */
  function hexToRGB(hex) {
    hex = hex.replace('#', '');
    return [
      parseInt(hex.substring(0, 2), 16) / 255,
      parseInt(hex.substring(2, 4), 16) / 255,
      parseInt(hex.substring(4, 6), 16) / 255
    ];
  }

  /* ── Compile a WebGL shader ── */
  function compileShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Aurora shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  /* ── Build a WebGL program ── */
  function createProgram(gl, vert, frag) {
    const p = gl.createProgram();
    gl.attachShader(p, vert);
    gl.attachShader(p, frag);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Aurora link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  /* ── State ── */
  let canvas = null;
  let gl = null;
  let program = null;
  let animId = 0;
  let running = false;

  /* Uniforms */
  let uTime, uAmplitude, uColorStops, uResolution, uBlend;

  /* Props (adjustable) */
  const props = {
    colorStops: ['#ff0000', '#000000', '#ff0021'],
    speed: 0.5,
    blend: 0.5,
    amplitude: 1.0
  };

  function resize() {
    if (!canvas || !gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (uResolution != null) gl.uniform2f(uResolution, canvas.width, canvas.height);
  }

  function start() {
    if (running) return;

    /* Create canvas */
    canvas = document.createElement('canvas');
    canvas.className = 'aurora-canvas';
    document.body.appendChild(canvas);

    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) { console.warn('Aurora: WebGL2 not supported'); stop(); return; }

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    /* Compile shaders */
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { stop(); return; }

    program = createProgram(gl, vs, fs);
    if (!program) { stop(); return; }
    gl.useProgram(program);

    /* Full-screen triangle (covers clip space without a quad) */
    const posAttr = gl.getAttribLocation(program, 'position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    /* Uniform locations */
    uTime       = gl.getUniformLocation(program, 'uTime');
    uAmplitude  = gl.getUniformLocation(program, 'uAmplitude');
    uColorStops = gl.getUniformLocation(program, 'uColorStops');
    uResolution = gl.getUniformLocation(program, 'uResolution');
    uBlend      = gl.getUniformLocation(program, 'uBlend');

    resize();
    window.addEventListener('resize', resize);

    running = true;
    animId = requestAnimationFrame(loop);
  }

  function loop(t) {
    if (!running || !gl || !program) return;
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform1f(uTime, t * 0.01 * props.speed * 0.1);
    gl.uniform1f(uAmplitude, props.amplitude);
    gl.uniform1f(uBlend, props.blend);

    const stops = props.colorStops.map(hexToRGB).flat();
    gl.uniform3fv(uColorStops, stops);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    animId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(animId);
    window.removeEventListener('resize', resize);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    canvas = null;
    gl = null;
    program = null;
  }

  /* ── Public API ── */
  window.UzoneAurora = {
    start,
    stop,
    isRunning() { return running; },
    setProps(p) { Object.assign(props, p); }
  };
})();
