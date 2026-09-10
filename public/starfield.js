function initStarfield() {
  const canvas = document.querySelector("#starfield");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  const reducedMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)");

  const BACKGROUND = "#14120B";
  const STAR_COLORS = ["#F2EADC", "#E7C98B", "#C69B5B", "#A88C68"];
  const MAX_STARS = 280;
  const PARALLAX_DISTANCE = 36;
  const PARALLAX_EASE = 7;
  const SCROLL_PARALLAX_FACTOR = 0.2;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  const stars = [];
  let animationFrame = 0;
  let lastTime = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;
  let targetParallaxX = 0;
  let targetParallaxY = 0;
  let parallaxX = 0;
  let parallaxY = 0;
  let targetScrollParallax = 0;
  let scrollParallax = 0;

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function createStar() {
    const depth = Math.random();
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      depth,
      radius: randomBetween(0.35, 1.55) + depth * 0.55,
      alpha: randomBetween(0.22, 0.78),
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: randomBetween(0.35, 1.15),
      drift: randomBetween(0.4, 1.7) + depth * 2.8,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
    };
  }

  function starCount() {
    return Math.min(MAX_STARS, Math.max(110, Math.round((width * height) / 7200)));
  }

  function setParallaxTarget(clientX, clientY) {
    targetParallaxX = ((width / 2 - clientX) / width) * PARALLAX_DISTANCE;
    targetParallaxY = ((height / 2 - clientY) / height) * PARALLAX_DISTANCE;
  }

  function handlePointerMove(event) {
    if (reducedMotion.matches || event.pointerType !== "mouse") return;

    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerActive = true;
    setParallaxTarget(pointerX, pointerY);
  }

  function resetParallax() {
    pointerActive = false;
    targetParallaxX = 0;
    targetParallaxY = 0;
  }

  function handleScroll() {
    if (reducedMotion.matches) return;
    targetScrollParallax = globalThis.scrollY * SCROLL_PARALLAX_FACTOR;
  }

  function wrap(value, range) {
    return ((value % range) + range) % range;
  }

  function getStarPosition(star) {
    const scrollShift = scrollParallax * (0.35 + star.depth * 0.65);

    return {
      x: star.x + parallaxX * star.depth,
      y: wrap(star.y + parallaxY * star.depth - scrollShift, height),
    };
  }

  function resize() {
    const previousWidth = width || globalThis.innerWidth;
    const previousHeight = height || globalThis.innerHeight;
    width = globalThis.innerWidth;
    height = globalThis.innerHeight;
    pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    stars.forEach((star) => {
      star.x = (star.x / previousWidth) * width;
      star.y = (star.y / previousHeight) * height;
    });

    while (stars.length < starCount()) stars.push(createStar());
    stars.length = Math.min(stars.length, starCount());

    if (pointerActive && !reducedMotion.matches) {
      setParallaxTarget(pointerX, pointerY);
    }

    draw(0);
  }

  function draw(time) {
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, width, height);

    stars.forEach((star) => {
      const twinkle = 0.78 + Math.sin(time * 0.001 * star.twinkleSpeed + star.phase) * 0.22;
      const alpha = Math.max(0.08, star.alpha * twinkle);
      const { x: drawX, y: drawY } = getStarPosition(star);

      context.globalAlpha = alpha;
      context.fillStyle = star.color;
      context.beginPath();
      context.arc(drawX, drawY, star.radius, 0, Math.PI * 2);
      context.fill();

      if (star.radius > 1.35) {
        context.globalAlpha = alpha * 0.28;
        context.fillRect(drawX - star.radius * 3.2, drawY - 0.35, star.radius * 6.4, 0.7);
        context.fillRect(drawX - 0.35, drawY - star.radius * 3.2, 0.7, star.radius * 6.4);
      }
    });

    context.globalAlpha = 1;
  }

  function animate(time) {
    const elapsed = Math.min((time - lastTime) / 1000, 0.08);
    lastTime = time;

    const parallaxEase = Math.min(1, elapsed * PARALLAX_EASE);
    parallaxX += (targetParallaxX - parallaxX) * parallaxEase;
    parallaxY += (targetParallaxY - parallaxY) * parallaxEase;
    scrollParallax += (targetScrollParallax - scrollParallax) * parallaxEase;

    stars.forEach((star) => {
      star.x += star.drift * elapsed;
      star.y -= star.drift * 0.22 * elapsed;

      if (star.x > width + 8) star.x = -8;
      if (star.y < -8) star.y = height + 8;
    });

    draw(time);
    animationFrame = globalThis.requestAnimationFrame(animate);
  }

  function start() {
    globalThis.cancelAnimationFrame(animationFrame);
    resize();

    if (reducedMotion.matches || document.hidden) {
      targetParallaxX = 0;
      targetParallaxY = 0;
      targetScrollParallax = 0;
      parallaxX = 0;
      parallaxY = 0;
      scrollParallax = 0;
      draw(0);
      return;
    }

    lastTime = performance.now();
    animationFrame = globalThis.requestAnimationFrame(animate);
  }

  globalThis.addEventListener("resize", resize, { passive: true });
  globalThis.addEventListener("scroll", handleScroll, { passive: true });
  globalThis.addEventListener("pointermove", handlePointerMove, { passive: true });
  globalThis.addEventListener("blur", resetParallax, { passive: true });
  reducedMotion.addEventListener("change", start);
  document.addEventListener("visibilitychange", start);
  handleScroll();
  start();
}
initStarfield();
