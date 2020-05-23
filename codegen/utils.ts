import prettier from 'prettier';
import { slugify } from 'transliteration';

const maxRetries = 5;
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export async function retry<T>(toDo: () => Promise<T>): Promise<T> {
    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
        try {
            return await toDo();
        }
        catch (e) {
            if (retryCount < maxRetries - 1) {
                let delay = Math.random() * 1000 * Math.pow(2, retryCount);
                console.warn(`Operation failed -- retrying in ${delay}ms`, e);
                await sleep(delay);
            }
            else {
                console.error("Operation failed -- giving up", e);
                throw e;
            }
        }
    }
    throw new Error("Impossible things are happening");
}
const maxThrottled = 50;
const ongoingThrottled = new Set<Promise<any>>();
export async function throttle<T>(toDo: () => Promise<T>): Promise<T> {
    if (ongoingThrottled.size < maxThrottled) {
        let resolve: () => void = () => { throw new Error("Should never be called"); };
        let promise = new Promise(r => {
            resolve = r;
        });
        ongoingThrottled.add(promise);
        try {
            return await toDo();
        }
        finally {
            ongoingThrottled.delete(promise);
            resolve();
        }
    }
    await Promise.race(ongoingThrottled);
    return await throttle(toDo);
}

export function format(source: string): string {
    return prettier.format(source, { parser: "typescript", semi: true })
}

export function identifier(label: string, lowerCamelCase: boolean = false) {
    label = label.replace('\'', '');
    label = slugify(label, { lowercase: true, separator: '-', allowedChars: 'a-zA-Z0-9_$' });
    label = label.split(/[^a-zA-Z0-9_$]+/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
    if (label.charAt(0) >= '0' && label.charAt(0) <= '9') {
        label = '$' + label;
    }
    if (lowerCamelCase) {
        label = label.charAt(0).toLowerCase() + label.slice(1);
    }
    return label;
}

export function sortByIdentifier(a: { id?: string }, b: { id?: string }) {
    return identifier(a.id!).localeCompare(identifier(b.id!));
};