# Contributing to Firestore Repository

Thank you for your interest in contributing! 🎉

## 🚀 Getting Started

1. **Fork the repository**
2. **Clone your fork**
   ```bash
   git clone https://github.com/yourusername/firestore-repository.git
   cd firestore-repository
   ```
3. **Install dependencies**
   ```bash
   npm install
   ```
4. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 🛠️ Development Setup

### Prerequisites
- Node.js 18+ 
- Firebase project with Firestore enabled
- Service account key (for testing)

### Environment Setup

Create `.env.test`:
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@email.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- FirestoreRepository.test.ts

# Run benchmarks
npm run benchmark
```

## 📝 Code Guidelines

### TypeScript Style

- Use **strict mode** (`strict: true` in tsconfig.json)
- Prefer `async/await` over promises
- Use **const** over **let** when possible
- Always define return types for public methods
- Use descriptive variable names (no single letters except loops)

### Example

```typescript
// ✅ Good
async function getUsersByAge(minAge: number): Promise<User[]> {
    const users = await userRepo.query()
        .where('age', '>=', minAge)
        .get();
    return users;
}

// ❌ Bad
async function getUsers(n: number) {
    let u = await userRepo.query().where('age', '>=', n).get();
    return u;
}
```

### Performance Guidelines

1. **Always parallelize independent async operations**
   ```typescript
   // ✅ Good - parallel
   const [user, orders] = await Promise.all([
       userRepo.getById(id),
       orderRepo.findByField('userId', id)
   ]);

   // ❌ Bad - sequential
   const user = await userRepo.getById(id);
   const orders = await orderRepo.findByField('userId', id);
   ```

2. **Use batch operations for bulk writes**
   - Automatically handled in `commitInChunks()`
   - Maximum 500 operations per batch

3. **Avoid unnecessary awaits**
   ```typescript
   // ❌ Bad
   await array.push(item);
   
   // ✅ Good
   array.push(item);
   ```

### Error Handling

- Always use try/catch in async methods
- Use custom error types: `NotFoundError`, `ValidationError`
- Wrap Firestore errors with `parseFirestoreError()`

```typescript
async someMethod(): Promise<void> {
    try {
        // your code
    } catch(error: any) {
        if (error instanceof z.ZodError) {
            throw new ValidationError(error.issues);
        }
        throw parseFirestoreError(error);
    }
}
```

## 🧪 Testing Requirements

All new features must include:

1. **Unit tests** - Test individual methods
2. **Integration tests** - Test with real Firestore (emulator)
3. **Type tests** - Ensure TypeScript types work correctly

### Test Structure

```typescript
describe('YourFeature', () => {
    let repo: FirestoreRepository<TestType>;

    beforeAll(async () => {
        // Setup
    });

    afterAll(async () => {
        // Cleanup
    });

    it('should do something correctly', async () => {
        // Arrange
        const input = { /* test data */ };

        // Act
        const result = await repo.someMethod(input);

        // Assert
        expect(result).toEqual(expectedOutput);
    });
});
```

## 📦 Pull Request Process

1. **Update tests** - All tests must pass
2. **Update documentation** - Update README if adding features
3. **Run linter** - `npm run lint`
4. **Run formatter** - `npm run format`
5. **Write clear commit messages**
   ```
   feat: add upsert method to repository
   fix: resolve race condition in bulk operations
   docs: improve query builder examples
   perf: parallelize bulk delete operations
   ```

6. **Create PR with description**
   - What does this PR do?
   - Why is this change needed?
   - Any breaking changes?
   - Screenshots/benchmarks if relevant

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update
- [ ] Performance improvement

## Testing
- [ ] All tests pass
- [ ] Added new tests for changes
- [ ] Tested with real Firestore

## Checklist
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
- [ ] Benchmarks run (if performance-related)
```

## 🐛 Bug Reports

When filing an issue, include:

1. **Clear description** of the bug
2. **Minimal reproduction** code
3. **Expected behavior** vs **actual behavior**
4.