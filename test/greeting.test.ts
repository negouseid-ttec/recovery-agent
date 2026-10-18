import { collectionGreeting } from '../lib/lambda/proactive-outreach';

describe('collectionGreeting (collection-message name guard)', () => {
    it('uses the customer name when present', () => {
        expect(collectionGreeting('Dana')).toBe('Hi Dana,');
    });

    it('trims surrounding whitespace from a real name', () => {
        expect(collectionGreeting('  Dana  ')).toBe('Hi Dana,');
    });

    it('falls back to a neutral greeting when the name is undefined (never "Hi undefined,")', () => {
        const g = collectionGreeting(undefined);
        expect(g).toBe('Hi there,');
        expect(g).not.toMatch(/undefined/);
    });

    it('falls back when the name is an empty or whitespace-only string', () => {
        expect(collectionGreeting('')).toBe('Hi there,');
        expect(collectionGreeting('   ')).toBe('Hi there,');
    });

    it('falls back for non-string values without throwing or rendering the value', () => {
        expect(collectionGreeting(null as unknown as string)).toBe('Hi there,');
        expect(collectionGreeting(42 as unknown as string)).toBe('Hi there,');
        expect(collectionGreeting(42 as unknown as string)).not.toMatch(/42/);
    });
});
