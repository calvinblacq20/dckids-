/* ===== Animated Shader Gradient Background ===== */
/* Recreates the ShaderGradient component using raw WebGL */

(function initShaderGradient() {
  const canvas = document.createElement('canvas');
  canvas.id = 'shaderGradientCanvas';
  canvas.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: -1;
    pointer-events: none;
  `;
  document.body.prepend(canvas);

  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
  if (!gl) {
    // Fallback: CSS gradient for older browsers
    canvas.remove();
    document.body.style.background = 'linear-gradient(135deg, #fff1eb 0%, #b9b7b8 50%, #dbdfe2 100%)';
    return;
  }

  // ── Vertex Shader ──
  const vertSrc = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // ── Fragment Shader ──
  // Organic wavy gradient matching ShaderGradient params:
  // color1=#fff1eb, color2=#b9b7b8, color3=#dbdfe2
  // type=plane, uAmplitude=1, uDensity=1.6, uFrequency=5.5, uSpeed=0.2, uStrength=4.8
  const fragSrc = `
    precision mediump float;

    uniform float u_time;
    uniform vec2  u_resolution;

    // Colors from ShaderGradient config
    const vec3 color1 = vec3(1.0, 0.945, 0.922);    // #fff1eb — warm cream
    const vec3 color2 = vec3(0.725, 0.718, 0.722);   // #b9b7b8 — soft grey
    const vec3 color3 = vec3(0.859, 0.875, 0.886);   // #dbdfe2 — silver

    // ShaderGradient params
    const float uAmplitude  = 1.0;
    const float uDensity    = 1.6;
    const float uFrequency  = 5.5;
    const float uSpeed      = 0.2;
    const float uStrength   = 4.8;

    // Simplex-like noise for organic flow
    vec3 mod289(vec3 x) { return x - floor(x / 289.0) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x / 289.0) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(
        0.211324865405187,   // (3.0 - sqrt(3.0)) / 6.0
        0.366025403784439,   // 0.5 * (sqrt(3.0) - 1.0)
       -0.577350269189626,   // -1.0 + 2.0 * C.x
        0.024390243902439    // 1.0 / 41.0
      );

      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);

      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;

      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

      vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
      m = m * m;
      m = m * m;

      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;

      m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;

      return 130.0 * dot(m, g);
    }

    // Fractal Brownian Motion for layered organic look
    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = uAmplitude * 0.5;
      float frequency = uFrequency * 0.3;

      for (int i = 0; i < 5; i++) {
        value += amplitude * snoise(p * frequency);
        p *= 2.0;
        amplitude *= 0.5;
        frequency *= uDensity * 0.6;
      }
      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;

      // Apply plane rotation (rotationX=0, rotationY=10, rotationZ=50)
      float angle = radians(50.0);
      vec2 center = vec2(0.5);
      uv -= center;
      uv = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * uv;
      uv += center;

      // Shift position (positionX=-1.4)
      uv.x += 0.35;

      float t = u_time * uSpeed;

      // Layer 1: Slow, large-scale wave
      float n1 = fbm(uv * uDensity + vec2(t * 0.3, t * 0.2));

      // Layer 2: Medium wave with offset
      float n2 = fbm(uv * uDensity * 1.5 + vec2(-t * 0.2, t * 0.4) + 3.14);

      // Layer 3: Fine detail
      float n3 = snoise(uv * uFrequency + vec2(t * 0.5, -t * 0.3)) * 0.3;

      // Combine layers with strength
      float strength = uStrength * 0.1;
      float pattern = (n1 + n2 * 0.7 + n3) * strength;

      // Create smooth gradient zones
      float zone1 = smoothstep(-0.5, 0.8, pattern + uv.x * 0.5 - uv.y * 0.3);
      float zone2 = smoothstep(-0.3, 1.0, pattern - uv.x * 0.3 + uv.y * 0.5 + 0.3);

      // Blend the three colors organically
      vec3 col = mix(color1, color2, zone1);
      col = mix(col, color3, zone2 * 0.6);

      // Add subtle brightness boost (brightness=1.2)
      col *= 1.2;

      // Soft vignette for depth
      float vignette = 1.0 - 0.15 * length(uv - center);
      col *= vignette;

      // Clamp to prevent blow-out
      col = clamp(col, 0.0, 1.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // ── Compile shaders ──
  function createShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('Shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vert = createShader(gl.VERTEX_SHADER, vertSrc);
  const frag = createShader(gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) return;

  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Program link error:', gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  // ── Fullscreen quad ──
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1
  ]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(program, 'u_time');
  const uRes  = gl.getUniformLocation(program, 'u_resolution');

  // ── Resize handling ──
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // Cap for performance
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // ── Render loop ──
  let startTime = performance.now();
  let animFrame;

  function render() {
    const elapsed = (performance.now() - startTime) * 0.001; // seconds
    gl.uniform1f(uTime, elapsed);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    animFrame = requestAnimationFrame(render);
  }

  // Pause when tab is hidden (battery saver)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(animFrame);
    } else {
      startTime = performance.now() - (performance.now() - startTime);
      render();
    }
  });

  render();
})();
