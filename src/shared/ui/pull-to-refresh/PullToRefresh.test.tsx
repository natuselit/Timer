// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PullToRefresh } from './PullToRefresh';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function pullPage(distance: number) {
  fireEvent.touchStart(document, {
    touches: [{ clientX: 40, clientY: 20 }]
  });
  fireEvent.touchMove(document, {
    cancelable: true,
    touches: [{ clientX: 42, clientY: 20 + distance }]
  });
}

describe('PullToRefresh', () => {
  it('shows the indicator and refreshes after the pull threshold', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <PullToRefresh onRefresh={onRefresh}>
        <main>Вміст</main>
      </PullToRefresh>
    );

    pullPage(140);

    expect(
      screen.getByRole('status', { name: 'Відпустіть для оновлення' })
    ).toBeTruthy();

    fireEvent.touchEnd(document);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('hides the indicator without refreshing before the threshold', () => {
    const onRefresh = vi.fn();

    render(
      <PullToRefresh onRefresh={onRefresh}>
        <main>Вміст</main>
      </PullToRefresh>
    );

    pullPage(80);
    expect(
      screen.getByRole('status', { name: 'Потягніть вниз для оновлення' })
    ).toBeTruthy();

    fireEvent.touchEnd(document);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not start the gesture when the page is already scrolled', () => {
    const onRefresh = vi.fn();
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(24);

    render(
      <PullToRefresh onRefresh={onRefresh}>
        <main>Вміст</main>
      </PullToRefresh>
    );

    pullPage(180);
    fireEvent.touchEnd(document);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not intercept a pull that starts on a button', () => {
    const onRefresh = vi.fn();

    render(
      <PullToRefresh onRefresh={onRefresh}>
        <button type="button">Прийшов</button>
      </PullToRefresh>
    );

    const button = screen.getByRole('button', { name: 'Прийшов' });
    fireEvent.touchStart(button, {
      touches: [{ clientX: 40, clientY: 20 }]
    });
    fireEvent.touchMove(document, {
      cancelable: true,
      touches: [{ clientX: 42, clientY: 180 }]
    });
    fireEvent.touchEnd(document);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
