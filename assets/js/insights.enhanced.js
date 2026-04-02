(function () {
  'use strict';

  const doc = document;
  const body = doc.body;

  if (!body || !body.classList.contains('insight-page')) {
    return;
  }

  const win = window;
  const prefersReducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const filterButtons = Array.from(doc.querySelectorAll('[data-insight-filter]'));
  const insightCards = Array.from(doc.querySelectorAll('[data-insight-card]'));
  const navItems = Array.from(doc.querySelectorAll('[data-insight-nav]'));
  const articles = Array.from(doc.querySelectorAll('[data-insight-article]'));
  const glowTargets = Array.from(doc.querySelectorAll('[data-insight-glow]'));
  const tiltTargets = Array.from(doc.querySelectorAll('[data-insight-tilt]'));
  const progressBar = doc.querySelector('[data-insight-progress-bar]');
  const resultCopy = doc.querySelector('[data-insight-result-copy]');
  const currentCategory = doc.querySelector('[data-current-article-category]');
  const currentReading = doc.querySelector('[data-current-article-reading]');
  const currentLabel = doc.querySelector('[data-current-article-label]');
  const currentCopy = doc.querySelector('[data-current-article-copy]');
  const filterLabels = new Map(
    filterButtons.map((button) => [button.dataset.insightFilter || 'all', button.dataset.insightLabel || button.textContent.trim()])
  );

  let activeFilter = 'all';

  function matchesFilter(filterValue, categoryValue) {
    return filterValue === 'all' || filterValue === categoryValue;
  }

  function updateProgress() {
    if (!progressBar) return;

    const scrollRange = doc.documentElement.scrollHeight - win.innerHeight;
    const progress = scrollRange > 0 ? Math.min(Math.max(win.scrollY / scrollRange, 0), 1) : 0;
    progressBar.style.transform = `scaleX(${progress})`;
  }

  function updateResultCopy() {
    if (!resultCopy) return;

    if (activeFilter === 'all') {
      resultCopy.textContent = `Showing all ${insightCards.length} briefings in the preview grid.`;
      return;
    }

    const visibleCount = insightCards.filter((card) => !card.hidden).length;
    const label = (filterLabels.get(activeFilter) || 'Selected').toLowerCase();
    resultCopy.textContent = `Showing ${visibleCount} ${label} briefing${visibleCount === 1 ? '' : 's'} in the preview grid.`;
  }

  function setCurrentArticle(article) {
    if (!article) return;

    const articleId = article.getAttribute('id') || '';
    const articleCategory = article.dataset.insightCategoryLabel || 'Briefing';
    const articleReading = article.dataset.insightReading || '';
    const articleTitle = article.querySelector('h2')?.textContent?.trim() || 'Insights article';
    const articleSummary = article.dataset.insightSummary || article.querySelector('p')?.textContent?.trim() || '';

    if (currentCategory) currentCategory.textContent = articleCategory;
    if (currentReading) currentReading.textContent = articleReading;
    if (currentLabel) currentLabel.textContent = articleTitle;
    if (currentCopy) currentCopy.textContent = articleSummary;

    navItems.forEach((item) => {
      const isActive = item.getAttribute('href') === `#${articleId}`;
      item.classList.toggle('is-active', isActive);
      if (isActive) {
        item.setAttribute('aria-current', 'location');
      } else {
        item.removeAttribute('aria-current');
      }
    });
  }

  function applyFilter(filterValue) {
    activeFilter = filterValue;

    filterButtons.forEach((button) => {
      const isActive = (button.dataset.insightFilter || 'all') === filterValue;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    insightCards.forEach((card) => {
      const match = matchesFilter(filterValue, card.dataset.insightCategory || '');
      card.hidden = !match;
      card.classList.toggle('is-filter-hidden', !match);
    });

    navItems.forEach((item) => {
      const match = matchesFilter(filterValue, item.dataset.insightCategory || '');
      item.classList.toggle('is-filter-muted', !match);
    });

    articles.forEach((article) => {
      const match = matchesFilter(filterValue, article.dataset.insightCategory || '');
      article.classList.toggle('is-filter-emphasis', filterValue === 'all' || match);
      article.classList.toggle('is-filter-softened', filterValue !== 'all' && !match);
    });

    updateResultCopy();
  }

  function bindGlow(target) {
    if (!target) return;

    target.addEventListener('pointermove', (event) => {
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      target.style.setProperty('--glow-x', `${x}px`);
      target.style.setProperty('--glow-y', `${y}px`);
    });

    target.addEventListener('pointerleave', () => {
      target.style.removeProperty('--glow-x');
      target.style.removeProperty('--glow-y');
    });
  }

  function bindTilt(target) {
    if (!target || prefersReducedMotion) return;

    target.addEventListener('pointermove', (event) => {
      const rect = target.getBoundingClientRect();
      const xRatio = (event.clientX - rect.left) / rect.width - 0.5;
      const yRatio = (event.clientY - rect.top) / rect.height - 0.5;
      target.style.setProperty('--tilt-x', `${(-yRatio * 5).toFixed(2)}deg`);
      target.style.setProperty('--tilt-y', `${(xRatio * 6).toFixed(2)}deg`);
    });

    target.addEventListener('pointerleave', () => {
      target.style.removeProperty('--tilt-x');
      target.style.removeProperty('--tilt-y');
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyFilter(button.dataset.insightFilter || 'all');
    });
  });

  glowTargets.forEach(bindGlow);
  tiltTargets.forEach(bindTilt);

  if ('IntersectionObserver' in win && articles.length) {
    const articleObserver = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio || left.boundingClientRect.top - right.boundingClientRect.top);

        if (visibleEntries[0]) {
          setCurrentArticle(visibleEntries[0].target);
        }
      },
      {
        rootMargin: '-18% 0px -52% 0px',
        threshold: [0.18, 0.34, 0.52, 0.7]
      }
    );

    articles.forEach((article) => articleObserver.observe(article));
  } else if (articles[0]) {
    setCurrentArticle(articles[0]);
  }

  let scrollTicking = false;
  function requestProgressUpdate() {
    if (scrollTicking) return;
    scrollTicking = true;
    win.requestAnimationFrame(() => {
      updateProgress();
      scrollTicking = false;
    });
  }

  applyFilter(activeFilter);
  updateProgress();

  if (articles[0]) {
    setCurrentArticle(articles[0]);
  }

  win.addEventListener('scroll', requestProgressUpdate, { passive: true });
  win.addEventListener('resize', requestProgressUpdate);
})();
