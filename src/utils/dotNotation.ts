/**
 * Utility functions for handling dot notation in nested object updates
 * Supports Firestore's dot notation syntax for updating nested fields
 */

/**
 * Checks if a key uses dot notation
 * @param key - The key to check
 * @returns true if the key contains a dot (.) character
 */

export function isDotNotation(key: string): boolean {
    return key.includes('.');
}

/**
 * Checks if an object contains any keys with dot notation
 * @param obj - The object to check
 * @returns true if any key in the object uses dot notation
 */

export function hasDotNotationKeys(obj: Record<string, any>): boolean {
    return Object.keys(obj).some(key => isDotNotation(key));
}

/**
 * Converts a flat object with dot notation keys into a nested object
 * Example:
 *   Input:  { 'address.city': 'LA', 'address.zip': '90001', name: 'John' }
 *   Output: { address: { city: 'LA', zip: '90001' }, name: 'John' }
 *
 * @param flatObj - Object with dot notation keys
 * @returns Nested object structure
 */

export function expandDotNotation<T = any>(
    flatObj: Record<string, any>
): T {
    const result: Record<string, any> = {};

    for(const [key, value] of Object.entries(flatObj)) {
        if(isDotNotation(key)){
            // Am simply splitting the key by dots
            const parts = key.split('.');
            let current = result;

            // Navigating thru the structure, creating objects as needed
            for(let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                // Initializing nested object if it doesn't exist
                if(!current[part] || typeof current[part] !== 'object') {
                    current[part] = {};
                }
                current = current[part];
            }

            // Setting the final value
            const lastPart = parts[parts.length - 1];
            current[lastPart] = value;
        }else {
            // Non-dot notation are added directly as usual
            result[key] = value;
        }
    }

    return result as T;
}

/**
 * Converts a nested object into a flat object with dot notation keys
 * Example:
 *   Input:  { address: { city: 'LA', zip: '90001' }, name: 'John' }
 *   Output: { 'address.city': 'LA', 'address.zip': '90001', name: 'John' }
 *
 * @param obj - Nested object to flatten
 * @param prefix - Internal prefix for recursion
 * @returns Flat object with dot notation keys
 */
export function flattenToDotNotation<T = any>(
    obj: Record<string, any>,
    prefix: string = ''
): Record<string, any> {
    const result: Record<string, any> = {};

    for(const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        // Only flatten plain objects, not arrays, dates, or other special types
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            !(value instanceof Date) &&
            Object.getPrototypeOf(value) === Object.prototype
        ) {
            // Recursively flatten nested objects
            Object.assign(result, flattenToDotNotation(value, fullKey));
        } else {
            result[fullKey] = value;
        }
    }
    return result;
}

/**
 * Merges dot notation updates with existing data
 * Handles both regular and dot notation keys in a mixed object
 *
 * @param existingData - Current document data
 * @param updates - Updates to apply (may contain dot notation)
 * @returns Merged data structure
 */
export function mergeDotNotationUpdate(
    existingData: Record<string, any>,
    updates: Record<string, any>
): Record<string, any> {
    const result = { ...existingData };

    for (const [key, value] of Object.entries(updates)) {
        // Skip undefined values - Firestore doesn't accept them
        if (value === undefined) {
            continue;
        }

        if (isDotNotation(key)) {
            // Handle dot notation
            const parts = key.split('.');
            let current = result;

            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];

                if (!current[part] || typeof current[part] !== 'object') {
                    current[part] = {};
                }

                current = current[part];
            }

            const lastPart = parts[parts.length - 1];
            current[lastPart] = value;
        }else{
            result[key] = value;
        }
    }
    return result;
}

/**
 * Validates dot notation paths to prevent invalid field names
 * @param key - The dot notation key to validate
 * @throws Error if the key is invalid
 */
export function validateDotNotationPath(key: string): void {
    if(!key || key.trim() === '') {
        throw new Error('Dot notation path cannot be empty');
    }

    if (key.startsWith('.') || key.endsWith('.')) {
        throw new Error(`Invalid dot notation path: "${key}". Path cannot start or end with a dot`);
    }

    const parts = key.split('.');

    for (const part of parts) {
        if (part.trim() === '') {
            throw new Error(`Invalid dot notation path: "${key}". Parts cannot be empty`);
        }
    }
}

/**
 * Extracts the root fields from dot notation paths
 * Example: ['address.city', 'address.zip', 'name'] => ['address', 'name']
 *
 * @param keys - Array of keys (may include dot notation)
 * @returns Array of root field names
 */

export function getRootFields(keys: string[]): string[] {
    const roots = new Set<string>();

    for (const key of keys) {
        const root = key.split('.')[0];
        roots.add(root);
    }
    return Array.from(roots);
}

/**
 * Gets the depth of a dot notation path
 * Example: 'address.city' => 2, 'name' => 1
 *
 * @param key - The dot notation key
 * @returns The depth of the path
 */
export function getDotNotationDepth(key: string): number {
    return key.split('.').length;
}