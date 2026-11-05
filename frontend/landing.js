'use strict';
// VeriMash landing page: reveal animations and the optional hero video.
(function(){
  const video = document.getElementById('heroVideo');
  const visual = document.querySelector('.hero-visual');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion && video) { video.pause(); }
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const sections = [...document.querySelectorAll('.section')];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
      }
    }, {threshold: 0.08});
    for (const section of sections) { section.classList.add('is-reveal-ready'); observer.observe(section); }
  }
  if (reduceMotion || !video) return;
  let activated = false;
  video.addEventListener('loadeddata', () => {
    if (!activated && video.videoWidth > 0) {
      activated = true;
      visual.classList.add('video-active');
      const playing = video.play();
      if (playing && typeof playing.catch === 'function') playing.catch(() => { visual.classList.remove('video-active'); });
    }
  });
  video.addEventListener('error', () => visual.classList.remove('video-active'));
  for (const source of video.querySelectorAll('source')) source.addEventListener('error', () => {});
})();
