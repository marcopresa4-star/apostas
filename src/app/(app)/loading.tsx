// Instant shell for every page while its data loads.
export default function Loading() {
  return (
    <div data-wide>
      <div className="skeleton mb-3 h-11 w-72 max-w-full" />
      <div className="skeleton mb-6 h-4 w-96 max-w-full" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="skeleton mt-4 h-64" />
      <div className="skeleton mt-4 h-40" />
    </div>
  );
}
