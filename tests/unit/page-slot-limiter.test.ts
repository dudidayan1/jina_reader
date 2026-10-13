/**
 * Tests for PageSlotLimiter — the cap on concurrently checked-out browser pages.
 * Pure logic, no browser.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import 'reflect-metadata';
import { PageSlotLimiter } from '../../build/services/page-slot-limiter';
import { ServiceNodeResourceDrainError } from '../../build/services/errors';

const tick = () => new Promise((r) => setImmediate(r));

describe('PageSlotLimiter', () => {
    it('grants slots immediately up to the cap, then queues', async () => {
        const lim = new PageSlotLimiter(2);
        await lim.acquire();
        await lim.acquire();
        let third = false;
        lim.acquire().then(() => { third = true; });
        await tick();
        assert.strictEqual(lim.inUse, 2);
        assert.strictEqual(lim.waiting, 1);
        assert.strictEqual(third, false);
    });

    it('serves waiters in FIFO order as slots are released', async () => {
        const lim = new PageSlotLimiter(1);
        const first = await lim.acquire();
        const order: number[] = [];
        const p1 = lim.acquire().then((t) => { order.push(1); return t; });
        const p2 = lim.acquire().then((t) => { order.push(2); return t; });
        lim.release(first);
        const t1 = await p1;
        await tick();
        assert.deepStrictEqual(order, [1]);
        lim.release(t1);
        await p2;
        assert.deepStrictEqual(order, [1, 2]);
        assert.strictEqual(lim.inUse, 1);
        assert.strictEqual(lim.waiting, 0);
    });

    it('release is idempotent (page ditched from several paths)', async () => {
        const lim = new PageSlotLimiter(2);
        const a = await lim.acquire();
        await lim.acquire();
        assert.strictEqual(lim.release(a), true);
        assert.strictEqual(lim.release(a), false);
        assert.strictEqual(lim.release(undefined), false);
        assert.strictEqual(lim.inUse, 1);
    });

    it('a new request cannot jump ahead of queued waiters', async () => {
        const lim = new PageSlotLimiter(1);
        const a = await lim.acquire();
        const order: string[] = [];
        lim.acquire().then(() => order.push('queued'));
        lim.release(a);
        lim.acquire().then(() => order.push('late'));
        await tick();
        assert.deepStrictEqual(order, ['queued']);
        assert.strictEqual(lim.waiting, 1);
    });

    it('reset() frees every slot (browser crash) and stale releases are no-ops', async () => {
        const lim = new PageSlotLimiter(2);
        const a = await lim.acquire();
        const b = await lim.acquire();
        const waiters = [lim.acquire(), lim.acquire()];
        lim.reset();
        const [c, d] = await Promise.all(waiters);
        assert.strictEqual(lim.inUse, 2);
        // Old pages get ditched later; must not free the new holders' slots.
        assert.strictEqual(lim.release(a), false);
        assert.strictEqual(lim.release(b), false);
        assert.strictEqual(lim.inUse, 2);
        lim.release(c);
        lim.release(d);
        assert.strictEqual(lim.inUse, 0);
    });

    it('rejects with a 503 ServiceNodeResourceDrainError after maxWaitMs and leaves the queue clean', async () => {
        const lim = new PageSlotLimiter(1, 30);
        const a = await lim.acquire();
        await assert.rejects(lim.acquire(), (err: any) => {
            assert.ok(err instanceof ServiceNodeResourceDrainError);
            assert.strictEqual(err.status, 50303);
            return true;
        });
        assert.strictEqual(lim.waiting, 0);
        lim.release(a);
        assert.strictEqual(lim.inUse, 0);
        await lim.acquire();
        assert.strictEqual(lim.inUse, 1);
    });

    it('never exceeds the cap under a burst of 200 concurrent requests', async () => {
        const lim = new PageSlotLimiter(16);
        let live = 0;
        let peak = 0;
        await Promise.all(Array.from({ length: 200 }, async () => {
            const t = await lim.acquire();
            live++;
            peak = Math.max(peak, live);
            await new Promise((r) => setTimeout(r, Math.random() * 5));
            live--;
            lim.release(t);
        }));
        assert.strictEqual(peak, 16);
        assert.strictEqual(lim.inUse, 0);
        assert.strictEqual(lim.waiting, 0);
    });
});
