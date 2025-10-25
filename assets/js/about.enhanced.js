(() => {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const body = document.body;
  if (!body) {
    return;
  }

  body.classList.add('about-has-js');

  const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const isReducedMotion = () => !!(mediaQuery && mediaQuery.matches);

  const hasIntersectionObserver = 'IntersectionObserver' in window;
  const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatNumber = (() => {
    try {
      const formatter = new Intl.NumberFormat('en-GB');
      return (value) => formatter.format(Math.round(value));
    } catch (error) {
      return (value) => Math.round(value).toString();
    }
  })();

  let toastStack;
  const ensureToastStack = () => {
    if (!toastStack) {
      toastStack = document.createElement('div');
      toastStack.className = 'about-toast-stack';
      toastStack.setAttribute('aria-live', 'polite');
      toastStack.setAttribute('aria-atomic', 'false');
      body.appendChild(toastStack);
    }
    return toastStack;
  };

  const showToast = (message) => {
    if (!message) return null;
    const stack = ensureToastStack();
    const toast = document.createElement('div');
    toast.className = 'about-toast';
    toast.textContent = message;
    stack.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });

    const hide = () => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => {
        toast.remove();
      }, 220);
    };

    const timeout = window.setTimeout(hide, 2400);
    toast.addEventListener('click', () => {
      window.clearTimeout(timeout);
      hide();
    });

    return toast;
  };

  window.hmjToast = { show: showToast };

  const copyText = async (text) => {
    if (!text) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // continue to fallback
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    body.appendChild(textarea);
    textarea.select();
    let succeeded = false;
    try {
      succeeded = document.execCommand('copy');
    } catch (error) {
      succeeded = false;
    }
    textarea.remove();
    return succeeded;
  };

  const initNav = () => {
    const burger = document.querySelector('.hmj-burger');
    const menu = document.getElementById('hmj-menu');
    const scrim = document.querySelector('.hmj-scrim');

    if (menu) {
      const currentSegment = (window.location.pathname.replace(/\/+$/, '').split('/').pop() || 'index.html').toLowerCase();
      menu.querySelectorAll('a[href]').forEach((link) => {
        const href = (link.getAttribute('href') || '').trim();
        if (!href || href.includes('://')) return;
        const normalized = href.replace(/^\/+/, '').split('#')[0].toLowerCase() || 'index.html';
        if (normalized === currentSegment) {
          link.setAttribute('aria-current', 'page');
        }
      });
    }

    if (!burger || !menu || !scrim) return;

    const setOpen = (open) => {
      burger.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('open', open);
      scrim.hidden = !open;
      document.documentElement.style.overflow = open ? 'hidden' : '';
    };

    burger.addEventListener('click', () => {
      const isOpen = burger.getAttribute('aria-expanded') === 'true';
      setOpen(!isOpen);
    });

    scrim.addEventListener('click', () => setOpen(false));

    menu.addEventListener('click', (event) => {
      const anchor = event.target.closest('a[href]');
      if (!anchor) return;
      window.requestAnimationFrame(() => setOpen(false));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    });
  };

  const initHeroParallax = () => {
    const hero = document.getElementById('aboutHero');
    if (!hero || isReducedMotion() || hero.dataset.parallaxBound === 'true') return;
    hero.dataset.parallaxBound = 'true';

    let frame = null;
    let lastX = 0;
    let lastY = 0;

    const update = (x, y) => {
      hero.style.setProperty('--mx', x.toFixed(3));
      hero.style.setProperty('--my', y.toFixed(3));
      const shineX = ((x + 0.5) * 100);
      const shineY = (0.5 - y) * 50;
      hero.style.setProperty('--shineX', shineX.toFixed(2));
      hero.style.setProperty('--shineY', shineY.toFixed(2));
    };

    const handle = (event) => {
      if (!hero || isReducedMotion()) return;
      const rect = hero.getBoundingClientRect();
      const relativeX = (event.clientX - rect.left) / rect.width - 0.5;
      const relativeY = (event.clientY - rect.top) / rect.height - 0.5;
      lastX = Math.max(Math.min(relativeX, 0.5), -0.5);
      lastY = Math.max(Math.min(relativeY, 0.5), -0.5);
      if (!frame) {
        frame = window.requestAnimationFrame(() => {
          update(lastX, lastY);
          frame = null;
        });
      }
    };

    hero.addEventListener('pointermove', handle);
    hero.addEventListener('pointerenter', handle);
    hero.addEventListener('pointerleave', () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      update(0, 0);
    });
  };

  const initTimeline = () => {
    const items = Array.from(document.querySelectorAll('.about-timeline__item'));
    if (!items.length) return;

    items.forEach((item) => {
      item.addEventListener('focus', () => item.classList.add('is-active'));
      item.addEventListener('blur', () => item.classList.remove('is-active'));
      item.addEventListener('mouseenter', () => item.classList.add('is-active'));
      item.addEventListener('mouseleave', () => item.classList.remove('is-active'));
    });
  };

  const initTeam = () => {
    const cards = Array.from(document.querySelectorAll('[data-team-card]'));
    if (!cards.length) return;

    const closeAll = () => {
      cards.forEach((card) => setOpen(card, false));
    };

    const setOpen = (card, open) => {
      if (!card) return;
      card.classList.toggle('is-active', open);
      const toggle = card.querySelector('[data-team-toggle]');
      const reveal = card.querySelector('.about-team__reveal');
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(open));
      }
      if (reveal) {
        reveal.setAttribute('aria-hidden', String(!open));
      }
    };

    cards.forEach((card) => {
      const toggle = card.querySelector('[data-team-toggle]');
      const reveal = card.querySelector('.about-team__reveal');
      if (reveal && !reveal.hasAttribute('aria-hidden')) {
        reveal.setAttribute('aria-hidden', 'true');
      }

      const toggleCard = (explicit) => {
        const open = typeof explicit === 'boolean' ? explicit : !card.classList.contains('is-active');
        setOpen(card, open);
      };

      if (toggle) {
        toggle.addEventListener('click', () => toggleCard());
      }

      card.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        if ((event.key === 'Enter' || event.key === ' ') && event.target === card) {
          event.preventDefault();
          toggleCard();
        } else if (event.key === 'Escape') {
          toggleCard(false);
          if (toggle) toggle.focus();
        }
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeAll();
      }
    });

    const copyButtons = document.querySelectorAll('[data-copy-link]');
    copyButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const url = button.getAttribute('data-copy-link');
        const success = await copyText(url);
        showToast(success ? 'Copied profile link' : 'Link copy unavailable');
      });
    });
  };

  const initValues = () => {
    const items = Array.from(document.querySelectorAll('.about-values__item'));
    if (!items.length) return;

    items.forEach((item) => {
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          if (event.target !== item) return;
          event.preventDefault();
          item.classList.toggle('is-active');
        } else if (event.key === 'Escape') {
          item.classList.remove('is-active');
          item.blur();
        }
      });

      item.addEventListener('blur', () => {
        item.classList.remove('is-active');
      });
    });
  };

  const initCounters = () => {
    const stats = Array.from(document.querySelectorAll('.about-stat[data-count]'));
    if (!stats.length) return;

    const animate = (element) => {
      const target = toNumber(element.getAttribute('data-count'));
      const suffix = element.getAttribute('data-suffix') || '';
      const numberEl = element.querySelector('.about-stat__number');
      if (!numberEl) return;
      if (isReducedMotion() || target <= 0) {
        numberEl.textContent = formatNumber(target) + suffix;
        return;
      }

      const duration = Math.min(Math.max(toNumber(element.getAttribute('data-duration')) || 900, 400), 1600);
      const startTime = performance.now();

      const step = (now) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = target * eased;
        numberEl.textContent = formatNumber(value) + suffix;
        if (progress < 1) {
          window.requestAnimationFrame(step);
        }
      };

      window.requestAnimationFrame(step);
    };

    if (!hasIntersectionObserver) {
      stats.forEach(animate);
      return;
    }

    const seen = new WeakSet();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !seen.has(entry.target)) {
          seen.add(entry.target);
          animate(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.45, rootMargin: '0px 0px -10% 0px' });

    stats.forEach((stat) => observer.observe(stat));
  };

  const initSlider = () => {
    const section = document.getElementById('aboutTestimonials');
    if (!section) return;
    const slider = section.querySelector('[data-slider]');
    const viewport = slider?.querySelector('[data-viewport]');
    if (!slider || !viewport) return;

    const slides = Array.from(viewport.querySelectorAll('[data-slide]'));
    if (!slides.length) return;

    const dotsContainer = slider.querySelector('.about-testimonials__dots');
    const prev = slider.querySelector('[data-prev]');
    const next = slider.querySelector('[data-next]');

    const dots = [];
    slides.forEach((slide, index) => {
      slide.setAttribute('role', 'tabpanel');
      slide.setAttribute('id', `about-testimonial-${index}`);
      slide.setAttribute('tabindex', index === 0 ? '0' : '-1');
      slide.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');
      if (dotsContainer) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-controls', slide.id);
        dot.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
        dot.setAttribute('tabindex', index === 0 ? '0' : '-1');
        dot.setAttribute('aria-label', `Show testimonial ${index + 1}`);
        dotsContainer.appendChild(dot);
        dots.push(dot);
      }
    });

    let activeIndex = 0;
    let autoplayId = null;
    let pointerState = null;

    section.hidden = false;

    const setActive = (index, { focus = false } = {}) => {
      const total = slides.length;
      activeIndex = (index + total) % total;
      const offset = activeIndex * -100;
      viewport.style.transform = `translateX(${offset}%)`;

      slides.forEach((slide, slideIndex) => {
        const isActive = slideIndex === activeIndex;
        slide.setAttribute('aria-hidden', String(!isActive));
        slide.setAttribute('tabindex', isActive ? '0' : '-1');
        if (isActive && focus) {
          slide.focus({ preventScroll: false });
        }
      });

      dots.forEach((dot, dotIndex) => {
        const isActive = dotIndex === activeIndex;
        dot.setAttribute('aria-selected', String(isActive));
        dot.setAttribute('tabindex', isActive ? '0' : '-1');
      });
    };

    const stopAutoplay = () => {
      if (autoplayId) {
        window.clearInterval(autoplayId);
        autoplayId = null;
      }
    };

    const startAutoplay = () => {
      if (isReducedMotion() || autoplayId) return;
      autoplayId = window.setInterval(() => {
        setActive(activeIndex + 1);
      }, 6000);
    };

    prev?.addEventListener('click', () => {
      stopAutoplay();
      setActive(activeIndex - 1, { focus: true });
    });

    next?.addEventListener('click', () => {
      stopAutoplay();
      setActive(activeIndex + 1, { focus: true });
    });

    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        stopAutoplay();
        setActive(index, { focus: true });
      });
    });

    const pointerDown = (event) => {
      pointerState = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      };
      slider.setPointerCapture(event.pointerId);
      stopAutoplay();
    };

    const pointerUp = (event) => {
      if (!pointerState || pointerState.id !== event.pointerId) return;
      slider.releasePointerCapture(event.pointerId);
      const dx = event.clientX - pointerState.startX;
      const dy = Math.abs(event.clientY - pointerState.startY);
      pointerState = null;
      if (Math.abs(dx) > 40 && dy < 80) {
        setActive(dx < 0 ? activeIndex + 1 : activeIndex - 1, { focus: true });
      }
      startAutoplay();
    };

    const pointerCancel = (event) => {
      if (!pointerState || pointerState.id !== event.pointerId) return;
      slider.releasePointerCapture(event.pointerId);
      pointerState = null;
      startAutoplay();
    };

    slider.addEventListener('pointerdown', pointerDown);
    slider.addEventListener('pointerup', pointerUp);
    slider.addEventListener('pointercancel', pointerCancel);
    slider.addEventListener('lostpointercapture', pointerCancel);

    slider.addEventListener('mouseenter', stopAutoplay);
    slider.addEventListener('mouseleave', startAutoplay);
    slider.addEventListener('focusin', stopAutoplay);
    slider.addEventListener('focusout', startAutoplay);

    slider.__hmjStopAutoplay = stopAutoplay;
    slider.__hmjStartAutoplay = startAutoplay;

    setActive(0);
    startAutoplay();
  };

  const initReveal = () => {
    const targets = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!targets.length) return;

    if (!hasIntersectionObserver) {
      targets.forEach((target) => target.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -12% 0px' });

    targets.forEach((target) => observer.observe(target));
  };

  const initTestimonialsPause = () => {
    const slider = document.querySelector('.about-testimonials__slider');
    if (!slider) return;
    slider.addEventListener('mouseenter', () => slider.classList.add('is-hover'));
    slider.addEventListener('mouseleave', () => slider.classList.remove('is-hover'));
  };

  const init = () => {
    initNav();
    initHeroParallax();
    initTimeline();
    initTeam();
    initValues();
    initCounters();
    initSlider();
    initReveal();
    initTestimonialsPause();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (mediaQuery) {
    mediaQuery.addEventListener('change', (event) => {
      const hero = document.getElementById('aboutHero');
      const slider = document.querySelector('.about-testimonials__slider');
      if (event.matches) {
        if (hero) {
          hero.style.setProperty('--mx', '0');
          hero.style.setProperty('--my', '0');
          hero.style.setProperty('--shineX', '50');
          hero.style.setProperty('--shineY', '0');
        }
        slider?.__hmjStopAutoplay?.();
      } else {
        initHeroParallax();
        slider?.__hmjStartAutoplay?.();
        initCounters();
      }
    });
  }
})();
