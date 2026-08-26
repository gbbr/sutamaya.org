import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateStep, cancelStepAnimations, prefersReducedMotion } from './motion';

// jsdom implements neither the Web Animations API nor a settable motion preference, so both are
// stood in for here. The stub records what it was asked to animate, which is the whole contract
// between ReaderPage's step and the browser.
type Recorded = { frames: Keyframe[]; opts: KeyframeAnimationOptions };

type FakeAnimation = { cancelled: boolean; cancel: () => void };

function fakeArticle() {
  const calls: Recorded[] = [];
  const animations: FakeAnimation[] = [];
  const el = {
    animate(frames: Keyframe[], opts: KeyframeAnimationOptions) {
      calls.push({ frames, opts });
      const anim: FakeAnimation = {
        cancelled: false,
        cancel: () => {
          anim.cancelled = true;
        },
      };
      animations.push(anim);
      return anim;
    },
    getAnimations() {
      return animations.filter((a) => !a.cancelled);
    },
  } as unknown as HTMLElement;
  return { el, calls, animations };
}

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
  }));
}

beforeEach(() => setReducedMotion(false));
afterEach(() => vi.unstubAllGlobals());

const transformsOf = (frames: Keyframe[]) => frames.map((f) => f.transform);

describe('animateStep', () => {
  it('brings the arriving sutta in from the edge the reader is travelling from', () => {
    const { el, calls } = fakeArticle();
    animateStep(el, 1);
    expect(transformsOf(calls[0].frames)).toEqual(['translateX(26px)', 'none']);
    animateStep(el, -1);
    expect(transformsOf(calls[1].frames)).toEqual(['translateX(-26px)', 'none']);
  });

  // Started from a layout effect, so without this the paint that follows can catch the new sutta
  // fully opaque and un-offset, flashing it before the animation's first frame.
  it('applies its opening frame from the moment it is created', () => {
    const { el, calls } = fakeArticle();
    animateStep(el, 1);
    expect(calls[0].opts.fill).toBe('backwards');
  });

  // Nothing may outlive its own run: a fill that keeps applying after the animation ends leaves
  // the reading pane stuck on that last frame for good.
  it('never fills forwards', () => {
    const { el, calls } = fakeArticle();
    animateStep(el, 1);
    setReducedMotion(true);
    animateStep(el, 1);
    expect(calls.map((c) => c.opts.fill)).toEqual(['backwards', 'backwards']);
  });

  describe('with reduced motion', () => {
    beforeEach(() => setReducedMotion(true));

    it('is what prefersReducedMotion reports', () => {
      expect(prefersReducedMotion()).toBe(true);
    });

    // Reduced motion asks for less movement, not for the step to become invisible — a step the
    // reader can't see happen is the problem this animation exists to solve.
    it('still animates the step, fading it without travelling', () => {
      const { el, calls } = fakeArticle();
      expect(animateStep(el, 1)).not.toBeNull();
      expect(transformsOf(calls[0].frames)).toEqual([undefined, undefined]);
      expect(calls[0].frames.map((f) => f.opacity)).toEqual([0, 1]);
    });
  });

  it('animates nothing where the Web Animations API is missing', () => {
    const el = {} as HTMLElement;
    expect(animateStep(el, 1)).toBeNull();
  });
});

describe('cancelStepAnimations', () => {
  it('releases every animation still applying to the element', () => {
    const { el, animations } = fakeArticle();
    animateStep(el, 1);
    animateStep(el, -1);
    cancelStepAnimations(el);
    expect(animations.every((a) => a.cancelled)).toBe(true);
  });

  it('is a no-op on an element that has never been animated', () => {
    const { el } = fakeArticle();
    expect(() => cancelStepAnimations(el)).not.toThrow();
    expect(() => cancelStepAnimations({} as HTMLElement)).not.toThrow();
  });
});
