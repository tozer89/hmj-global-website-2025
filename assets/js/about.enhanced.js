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

  const SEEDED_NOTICEBOARD_NOTICES = [
    {
      id: 'seeded-notice-1',
      slug: 'frankfurt-benelux-mobilisation-planning',
      category: 'Project note',
      kicker: 'Featured sector update',
      title: 'Frankfurt and Benelux programmes are pushing mobilisation planning earlier',
      summary: 'Live projects are asking for document packs, payroll expectations and onboarding timelines to be discussed earlier so contractors can move with fewer last-minute surprises.',
      body: `Across several live European programmes, the biggest source of friction is not finding interest in the role. It is the gap between offer stage and a contractor being genuinely ready to start.\n\nClients are increasingly asking for mobilisation conversations to begin earlier, especially where travel, accommodation, access windows and local payroll expectations all affect confidence.\n\n- Earlier right-to-work and document reviews reduce late churn\n- Clear payroll and rotation conversations improve confidence before start\n- Site contacts and induction timing matter just as much as the offer itself`,
      publishAt: '2026-03-12T09:00:00.000Z',
      featured: true,
      ctaLabel: 'Open roles',
      ctaUrl: 'jobs.html',
    },
    {
      id: 'seeded-notice-2',
      slug: 'commissioning-support-roles-expanding',
      category: 'Sector note',
      title: 'Commissioning demand is widening beyond the usual lead roles',
      summary: 'Projects are not only looking for lead commissioning engineers. They also need planners, turnover support, QA coordination and contractor-facing admin support to keep interfaces moving.',
      body: `The strongest demand is no longer limited to the headline leadership appointments. More programmes are asking for surrounding support roles that keep commissioning teams organised and productive.\n\nThat includes planners, turnover administrators, QA support, document coordination and site-facing roles that help maintain handover pace when multiple systems are moving together.`,
      publishAt: '2026-03-09T09:00:00.000Z',
      featured: false,
      ctaLabel: 'Register interest',
      ctaUrl: 'candidates.html',
    },
    {
      id: 'seeded-notice-3',
      slug: 'payroll-clarity-before-start-date',
      category: 'Payroll update',
      title: 'Contractors are asking for payroll detail much earlier in the process',
      summary: 'Payment cadence, deductions, local rules and timesheet routes are increasingly part of the pre-start conversation, especially on fast-track cross-border moves.',
      body: `On fast-moving assignments, payroll clarity is often a retention issue as much as an admin issue.\n\nContractors want to understand the practical side early: how timesheets are approved, how deductions work, what the pay rhythm looks like and who to contact if something changes once they are live.`,
      publishAt: '2026-03-05T09:00:00.000Z',
      featured: false,
      ctaLabel: 'Talk to HMJ',
      ctaUrl: 'contact.html',
    },
    {
      id: 'seeded-notice-4',
      slug: 'document-packs-before-offer-sign-off',
      category: 'Mobilisation',
      title: 'Cross-border starts are smoother when document packs are reviewed before offer sign-off',
      summary: 'Projects that map compliance documents early tend to avoid the last-minute friction that can derail a seemingly straightforward mobilisation.',
      body: `When start dates are tight, the real delay often comes from paperwork that was left until after the offer was agreed.\n\n- Passport and right-to-work checks should be clear before travel is discussed\n- Site-specific requirements need to be visible early, not after acceptance\n- Contractors are more likely to commit when the route to site feels organised`,
      publishAt: '2026-02-27T09:00:00.000Z',
      featured: false,
      ctaLabel: 'See opportunities',
      ctaUrl: 'jobs.html',
    },
    {
      id: 'seeded-notice-5',
      slug: 'schedule-shifts-and-retention',
      category: 'Retention',
      title: 'Retention risk rises when schedules shift without clear communication',
      summary: 'The programmes that hold people best tend to explain changing dates, reporting lines and site expectations quickly rather than letting uncertainty build.',
      body: `Contractors can usually absorb pressure better than uncertainty.\n\nWhere schedules move, confidence holds up better when the project communicates clearly about revised start timing, expected rotations and who the contractor should speak to when something changes.`,
      publishAt: '2026-02-20T09:00:00.000Z',
      featured: false,
      ctaLabel: 'Contact HMJ',
      ctaUrl: 'contact.html',
    }
  ];

  const TEAM_FALLBACK_CARDS = [
    {
      initials: 'DL',
      title: 'Delivery leadership',
      summary: 'Recruitment support aligned to package scope, reporting lines and the pressure points affecting live site delivery.'
    },
    {
      initials: 'MC',
      title: 'Mobilisation & compliance',
      summary: 'Pre-start documentation, onboarding coordination and cross-border readiness handled with a clear route to site.'
    },
    {
      initials: 'PC',
      title: 'Payroll & contractor care',
      summary: 'Timesheets, pay queries, extensions and continuity support once teams are live and schedules begin to move.'
    }
  ];

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
    const section = document.getElementById('aboutTeam');
    const grid = document.getElementById('aboutTeamGrid') || section?.querySelector('[data-team-grid]');
    const emptyState = document.getElementById('aboutTeamEmpty');
    if (!section || !grid) return;

    const escapeHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const deriveFirstName = (fullName) => {
      const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
      return parts[0] || 'HMJ';
    };

    const renderMemberParagraphs = (member) => {
      const parts = [member?.shortCaption, member?.fullBio]
        .map((item) => String(item || '').trim())
        .filter((item, index, list) => item && list.indexOf(item) === index);

      if (!parts.length) {
        return '<p>More profile detail will appear here soon.</p>';
      }

      return parts
        .map((item) => `<p>${escapeHtml(item)}</p>`)
        .join('');
    };

    const mediaMarkup = (member) => {
      if (member?.imageUrl) {
        return `<img src="${escapeHtml(member.imageUrl)}" alt="${escapeHtml(member.imageAltText || member.fullName || 'HMJ team member')}" loading="lazy" data-team-image />`;
      }
      return '<div class="about-team__media-placeholder">HMJ Team</div>';
    };

    const linkedInMarkup = (member) => {
      if (!member?.linkedinUrl) return '';
      const label = `${member.fullName || 'HMJ team member'} on LinkedIn`;
      return `
        <div class="about-team__links">
          <a class="about-team__link" href="${escapeHtml(member.linkedinUrl)}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm.02 5.75H2V21h3V9.25zm5.75 0H8V21h3v-6.2c0-1.65.62-2.77 2.17-2.77 1.18 0 1.84.8 1.84 2.77V21h3v-6.95C18 10.59 16.48 9 14.36 9c-1.68 0-2.83.87-3.36 1.8h-.05z"/></svg>
          </a>
          <button type="button" class="about-team__copy" data-copy-link="${escapeHtml(member.linkedinUrl)}">Copy profile link</button>
        </div>
      `;
    };

    const renderFallbackState = () => {
      if (!emptyState) return;
      emptyState.innerHTML = `
        <div class="about-team__fallback">
          <div class="about-team__fallback-copy">
            <span class="about-team__fallback-label">Leadership profiles coming soon</span>
            <h3>HMJ still supports programmes through connected delivery, mobilisation and payroll functions.</h3>
            <p>When live team profiles have not yet been published, the About page switches to an intentional fallback rather than leaving this area blank. The model remains the same: specialist recruitment supported by practical onboarding, compliance coordination and contractor care.</p>
          </div>
          <div class="about-team__fallback-grid" aria-label="HMJ leadership fallback roles">
            ${TEAM_FALLBACK_CARDS.map((card) => `
              <article class="about-team__fallback-card">
                <div class="about-team__fallback-avatar" aria-hidden="true">${escapeHtml(card.initials)}</div>
                <div class="about-team__fallback-body">
                  <h4>${escapeHtml(card.title)}</h4>
                  <p>${escapeHtml(card.summary)}</p>
                </div>
              </article>
            `).join('')}
          </div>
        </div>
      `;
    };

    const bindCardInteractions = () => {
      const cards = Array.from(grid.querySelectorAll('[data-team-card]'));
      if (!cards.length) return;

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
        if (card.dataset.teamBound === 'true') return;
        card.dataset.teamBound = 'true';
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

      if (!document.documentElement.dataset.teamEscapeBound) {
        document.documentElement.dataset.teamEscapeBound = 'true';
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            cards.forEach((card) => setOpen(card, false));
          }
        });
      }

      const copyButtons = grid.querySelectorAll('[data-copy-link]');
      copyButtons.forEach((button) => {
        if (button.dataset.teamCopyBound === 'true') return;
        button.dataset.teamCopyBound = 'true';
        button.addEventListener('click', async () => {
          const url = button.getAttribute('data-copy-link');
          const success = await copyText(url);
          showToast(success ? 'Copied profile link' : 'Link copy unavailable');
        });
      });

      const images = grid.querySelectorAll('[data-team-image]');
      images.forEach((image) => {
        if (image.dataset.teamImageBound === 'true') return;
        image.dataset.teamImageBound = 'true';
        image.addEventListener('error', () => {
          const media = image.closest('.about-team__media');
          if (!media) return;
          media.innerHTML = '<div class="about-team__media-placeholder">HMJ Team</div>';
        }, { once: true });
      });
    };

    const renderMembers = (members) => {
      const list = Array.isArray(members) ? members : [];
      if (!list.length) {
        grid.innerHTML = '';
        grid.hidden = true;
        renderFallbackState();
        if (emptyState) emptyState.hidden = false;
        return;
      }

      grid.hidden = false;
      if (emptyState) emptyState.hidden = true;
      grid.innerHTML = list.map((member, index) => {
        const slug = String(member?.slug || `team-member-${index + 1}`).replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
        const titleId = `team-${slug}-title`;
        const revealId = `team-${slug}-reveal`;
        const firstName = deriveFirstName(member?.firstName || member?.fullName);
        return `
          <article class="about-team__card" data-team-card tabindex="0" aria-labelledby="${escapeHtml(titleId)}">
            <figure class="about-team__media">
              ${mediaMarkup(member)}
            </figure>
            <div class="about-team__content">
              <h3 id="${escapeHtml(titleId)}">${escapeHtml(member?.fullName || 'HMJ team member')}</h3>
              <p class="about-team__role">${escapeHtml(member?.roleTitle || 'Team role')}</p>
              <button type="button" class="about-team__toggle" data-team-toggle aria-expanded="false" aria-controls="${escapeHtml(revealId)}">More about ${escapeHtml(firstName)}</button>
            </div>
            <div class="about-team__reveal" id="${escapeHtml(revealId)}" aria-hidden="true">
              ${renderMemberParagraphs(member)}
              ${linkedInMarkup(member)}
            </div>
          </article>
        `;
      }).join('');
      bindCardInteractions();
    };

    renderFallbackState();

    fetch('/.netlify/functions/team-list', {
      headers: { Accept: 'application/json' }
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Team request failed (${response.status})`);
        }
        return response.json();
      })
      .then((payload) => {
        renderMembers(payload?.members);
      })
      .catch((error) => {
        console.warn('[about] team unavailable', error);
        renderMembers([]);
      });
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

  const initNoticeboard = () => {
    const section = document.getElementById('aboutNoticeboard');
    if (!section) return;

    const featuredHost = document.getElementById('noticeboardFeatured');
    const railHost = document.getElementById('noticeboardRail');
    const gridHost = document.getElementById('noticeboardGrid');
    const emptyState = document.getElementById('noticeboardEmpty');
    const dialog = document.getElementById('aboutNoticeDialog');
    const dialogMedia = document.getElementById('aboutNoticeDialogMedia');
    const dialogDate = document.getElementById('aboutNoticeDialogDate');
    const dialogTitle = document.getElementById('aboutNoticeDialogTitle');
    const dialogBody = document.getElementById('aboutNoticeDialogBody');
    const dialogActions = document.getElementById('aboutNoticeDialogActions');
    const closeControls = dialog ? Array.from(dialog.querySelectorAll('[data-notice-close]')) : [];
    const closeButton = dialog ? dialog.querySelector('.about-dialog__close') : null;

    const state = {
      notices: [],
      lastTrigger: null,
    };

    const formatDate = (() => {
      try {
        const formatter = new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
        return (value) => formatter.format(new Date(value));
      } catch (error) {
        return (value) => value;
      }
    })();

    const escapeHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const deriveExcerpt = (value, maxLength = 170) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      if (text.length <= maxLength) return text;
      return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
    };

    const renderNoticeBlocks = (value) => {
      const blocks = String(value || '')
        .split(/\n\s*\n/)
        .map((item) => item.trim())
        .filter(Boolean);

      if (!blocks.length) {
        return '<p>No additional detail is available for this update yet.</p>';
      }

      return blocks.map((block) => {
        const lines = block
          .split(/\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        if (lines.length > 1 && lines.every((line) => /^[-*]\s+/.test(line))) {
          return `<ul>${lines.map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
        }

        return `<p>${lines.map((line) => escapeHtml(line)).join('<br/>')}</p>`;
      }).join('');
    };

    const mediaMarkup = (notice, placeholder = 'HMJ Update') => {
      if (notice?.imageUrl) {
        return `<img src="${escapeHtml(notice.imageUrl)}" alt="${escapeHtml(notice.imageAltText || notice.title || placeholder)}" loading="lazy" />`;
      }
      return `<div class="about-noticeboard__media-placeholder">${escapeHtml(placeholder)}</div>`;
    };

    const featuredMarkup = (notice, index) => {
      const summary = notice.summary || deriveExcerpt(notice.body, 180);
      const kicker = notice.kicker || notice.category || (notice.featured ? 'Featured update' : 'Latest update');
      const ctaMarkup = notice.ctaUrl
        ? `<a class="btn-secondary" href="${escapeHtml(notice.ctaUrl)}">${escapeHtml(notice.ctaLabel || 'Related link')}</a>`
        : '';

      return `
        <article class="about-noticeboard__featured-card">
          <div class="about-noticeboard__media">${mediaMarkup(notice, 'HMJ Bulletin')}</div>
          <div class="about-noticeboard__content">
            <div class="about-noticeboard__meta">
              <span class="about-noticeboard__tag">${escapeHtml(kicker)}</span>
              <time class="about-noticeboard__date" datetime="${escapeHtml(notice.publishAt || '')}">${escapeHtml(formatDate(notice.publishAt || Date.now()))}</time>
            </div>
            <h3>${escapeHtml(notice.title)}</h3>
            <p class="about-noticeboard__body-copy">${escapeHtml(summary)}</p>
            <div class="about-noticeboard__actions">
              <button type="button" class="btn-primary about-noticeboard__read" data-notice-open="${index}">Read update</button>
              ${ctaMarkup}
            </div>
          </div>
        </article>
      `;
    };

    const cardMarkup = (notice, index) => {
      const summary = notice.summary || deriveExcerpt(notice.body, 120);
      const tag = notice.category || (notice.featured ? 'Featured' : '');
      const ctaMarkup = notice.ctaUrl
        ? `<a class="btn-secondary" href="${escapeHtml(notice.ctaUrl)}">${escapeHtml(notice.ctaLabel || 'Open link')}</a>`
        : '';

      return `
        <article class="about-noticeboard__card">
          <div class="about-noticeboard__media">${mediaMarkup(notice, 'Company Notice')}</div>
          <div class="about-noticeboard__content">
            <div class="about-noticeboard__meta">
              <time class="about-noticeboard__date" datetime="${escapeHtml(notice.publishAt || '')}">${escapeHtml(formatDate(notice.publishAt || Date.now()))}</time>
              ${tag ? `<span class="about-noticeboard__tag">${escapeHtml(tag)}</span>` : ''}
            </div>
            <h3>${escapeHtml(notice.title)}</h3>
            <p>${escapeHtml(summary)}</p>
            <div class="about-noticeboard__card-actions">
              <button type="button" class="btn-primary about-noticeboard__read" data-notice-open="${index}">Read update</button>
              ${ctaMarkup}
            </div>
          </div>
        </article>
      `;
    };

    const openDialog = (index, trigger) => {
      const notice = state.notices[index];
      if (!notice || !dialog) return;

      state.lastTrigger = trigger || null;
      dialogDate.textContent = formatDate(notice.publishAt || Date.now());
      dialogTitle.textContent = notice.title || 'Notice';
      dialogBody.innerHTML = renderNoticeBlocks(notice.body);
      dialogMedia.innerHTML = notice.imageUrl
        ? `<img src="${escapeHtml(notice.imageUrl)}" alt="${escapeHtml(notice.imageAltText || notice.title || 'Notice image')}" />`
        : '<div class="about-dialog__media-placeholder">HMJ Bulletin</div>';
      dialogActions.innerHTML = notice.ctaUrl
        ? `<a class="btn-primary" href="${escapeHtml(notice.ctaUrl)}">${escapeHtml(notice.ctaLabel || 'Open link')}</a>`
        : '';

      dialog.hidden = false;
      dialog.setAttribute('aria-hidden', 'false');
      body.classList.add('about-dialog-open');
      closeButton?.focus({ preventScroll: true });
    };

    const closeDialog = () => {
      if (!dialog || dialog.hidden) return;
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
      body.classList.remove('about-dialog-open');
      if (state.lastTrigger && typeof state.lastTrigger.focus === 'function') {
        state.lastTrigger.focus({ preventScroll: true });
      }
      state.lastTrigger = null;
    };

    closeControls.forEach((control) => {
      control.addEventListener('click', closeDialog);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDialog();
      }
    });

    section.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-notice-open]');
      if (!trigger) return;
      const index = Number(trigger.getAttribute('data-notice-open'));
      if (Number.isFinite(index)) {
        openDialog(index, trigger);
      }
    });

    fetch('/.netlify/functions/noticeboard-list', {
      headers: { Accept: 'application/json' }
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Noticeboard request failed (${response.status})`);
        }
        return response.json();
      })
      .then((payload) => {
        if (payload?.enabled === false) {
          section.hidden = true;
          return;
        }

        const liveNotices = Array.isArray(payload?.notices) ? payload.notices : [];
        const notices = liveNotices.length ? liveNotices : SEEDED_NOTICEBOARD_NOTICES;
        state.notices = notices;
        section.hidden = false;
        section.dataset.noticeSource = liveNotices.length ? 'live' : 'fallback';

        if (!notices.length) {
          if (featuredHost) featuredHost.innerHTML = '';
          if (railHost) railHost.innerHTML = '';
          if (gridHost) gridHost.innerHTML = '';
          if (emptyState) emptyState.hidden = false;
          return;
        }

        if (emptyState) emptyState.hidden = true;

        const [featured, ...rest] = notices;
        const rail = rest.slice(0, 3);
        const grid = rest.slice(3);

        if (featuredHost) {
          featuredHost.innerHTML = featured ? featuredMarkup(featured, 0) : '';
        }
        if (railHost) {
          railHost.innerHTML = rail.map((notice, offset) => cardMarkup(notice, offset + 1)).join('');
        }
        if (gridHost) {
          gridHost.innerHTML = grid.map((notice, offset) => cardMarkup(notice, offset + 4)).join('');
          gridHost.hidden = !grid.length;
        }
      })
      .catch((error) => {
        console.warn('[about] noticeboard unavailable', error);
        state.notices = SEEDED_NOTICEBOARD_NOTICES;
        section.hidden = false;
        section.dataset.noticeSource = 'fallback';
        if (emptyState) emptyState.hidden = true;

        const [featured, ...rest] = SEEDED_NOTICEBOARD_NOTICES;
        const rail = rest.slice(0, 3);
        const grid = rest.slice(3);

        if (featuredHost) {
          featuredHost.innerHTML = featured ? featuredMarkup(featured, 0) : '';
        }
        if (railHost) {
          railHost.innerHTML = rail.map((notice, offset) => cardMarkup(notice, offset + 1)).join('');
        }
        if (gridHost) {
          gridHost.innerHTML = grid.map((notice, offset) => cardMarkup(notice, offset + 4)).join('');
          gridHost.hidden = !grid.length;
        }
      });
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
    initNoticeboard();
    initTeam();
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
      }
    });
  }
})();
