Template.ApplicationLayout.onRendered(function () {
  const instance = this;

  instance._resizeObserver = null;
  instance._boundHandlers = {};

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && ApplicationLayout.anyOpen()) {
      ApplicationLayout.close();
    }
  };

  document.addEventListener('keydown', instance._boundHandlers.keydown = handleKeyDown);

  // Desktop drag panels with constraints
  instance.$('.panel-containment').on('mousedown', function(e) {
    const handle = e.target.closest('.panel-handle');
    if (!handle && e.target.classList.contains('panel-containment')) {
      return;
    }
    
    const panel = this;
    const isLeft = panel.classList.contains('left');
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;
    const maxWidth = window.innerWidth * 0.85;
    const minWidth = 200;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const move = (e) => {
      let dx = isLeft ? e.clientX - startX : startWidth - (e.clientX - startX);
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + dx));
      panel.style.width = newWidth + 'px';
      
      const content = document.querySelector('.content-containment');
      if (content) {
        content.style.transition = 'none';
      }
    };

    const up = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      
      const id = panel.dataset.id;
      const side = isLeft ? 'left' : 'right';
      if (id) {
        ApplicationLayout.updatePanel(side, id, { width: panel.offsetWidth });
      }
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // Double-click to toggle panel
  instance.$('.panel-handle, .panel-containment').on('dblclick', function(e) {
    const panel = this.closest('.panel-containment');
    if (!panel) return;
    
    const id = panel.dataset.id;
    const side = panel.classList.contains('left') ? 'left' : 'right';
    if (id) {
      ApplicationLayout.toggle(side, id);
    }
  });

  // Mobile gestures with momentum
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isScrolling = false;

  instance.$('.application-containment').on('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    isScrolling = false;
    
    const layout = ApplicationLayout.get();
    const content = instance.$('.content-containment');
    if (content && (layout.leftPanels?.some(p => p.open) || layout.rightPanels?.some(p => p.open))) {
      content[0].style.transition = 'none';
    }
  });

  instance.$('.application-containment').on('touchmove', function(e) {
    const dx = Math.abs(e.touches[0].clientX - touchStartX);
    const dy = Math.abs(e.touches[0].clientY - touchStartY);
    if (dy > dx && !isScrolling) {
      isScrolling = true;
    }
  });

  instance.$('.application-containment').on('touchend', function(e) {
    if (isScrolling) return;
    
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dt = Date.now() - touchStartTime;
    const velocity = Math.abs(dx) / dt;
    const threshold = velocity > 0.5 ? 50 : 80;
    
    if (dx > threshold) {
      const layout = ApplicationLayout.get();
      ApplicationLayout.open('left', layout.leftPanels?.[0]?.id);
    } else if (dx < -threshold) {
      const layout = ApplicationLayout.get();
      ApplicationLayout.open('right', layout.rightPanels?.[0]?.id);
    }
  });

  // Back to top button visibility
  const checkBackToTop = () => {
    const panels = instance.$('.panel-containment, .content-containment');
    panels.each(function() {
      const btn = this.querySelector('.back-to-top');
      if (btn) {
        btn.classList.toggle('show', this.scrollTop > 200);
      }
    });
  };

  instance.$('.panel-containment, .content-containment').on('scroll', checkBackToTop);
  instance._backToTopInterval = setInterval(checkBackToTop, 500);
});

Template.ApplicationLayout.onDestroyed(function () {
  document.removeEventListener('keydown', this._boundHandlers.keydown);
  clearInterval(this._backToTopInterval);
});
