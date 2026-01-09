describe('Smoke Test', () => {
  test('Jest and TypeScript are configured correctly', () => {
    expect(true).toBe(true);
  });
  
  test('Can use TypeScript features', () => {
    const add = (a: number, b: number): number => a + b;
    expect(add(2, 3)).toBe(5);
  });
});