import { ServiceNodeResourceDrainError } from './errors';

interface SlotWaiter {
    ticket: object;
    resolve: (ticket: object) => void;
    reject: (err: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
}

/**
 * FIFO counting semaphore bounding how many browser pages are checked out at once.
 *
 * `acquire()` hands out an opaque ticket; `release(ticket)` is idempotent, so a page that gets
 * ditched from several paths (scrap finally, 5 minute finalizer, browser crash) frees its slot
 * exactly once. `reset()` drops every held slot (used when the browser crashes and all pages die
 * with it). Waiters that are not served within `maxWaitMs` fail with a 503 so the caller retries.
 */
export class PageSlotLimiter {
    protected active = new Set<object>();
    protected waiters: SlotWaiter[] = [];

    constructor(public maxSlots: number, public maxWaitMs: number = 0) { }

    get inUse() {
        return this.active.size;
    }

    get waiting() {
        return this.waiters.length;
    }

    acquire(): Promise<object> {
        const ticket = {};
        if (this.active.size < this.maxSlots && !this.waiters.length) {
            this.active.add(ticket);

            return Promise.resolve(ticket);
        }

        return new Promise<object>((resolve, reject) => {
            const waiter: SlotWaiter = { ticket, resolve, reject };
            if (this.maxWaitMs > 0) {
                waiter.timer = setTimeout(() => {
                    const idx = this.waiters.indexOf(waiter);
                    if (idx >= 0) {
                        this.waiters.splice(idx, 1);
                    }
                    reject(new ServiceNodeResourceDrainError(
                        `This worker node is at its browser page capacity (${this.maxSlots}), try again later.`
                    ));
                }, this.maxWaitMs);
            }
            this.waiters.push(waiter);
        });
    }

    release(ticket?: object) {
        if (!ticket || !this.active.delete(ticket)) {
            return false;
        }
        this.drain();

        return true;
    }

    reset() {
        this.active.clear();
        this.drain();
    }

    protected drain() {
        while (this.active.size < this.maxSlots && this.waiters.length) {
            const waiter = this.waiters.shift()!;
            if (waiter.timer) {
                clearTimeout(waiter.timer);
            }
            this.active.add(waiter.ticket);
            waiter.resolve(waiter.ticket);
        }
    }
}
