import React, { useEffect, useMemo, useState } from "react";

type Props = {
  movie: { id: string; title: string; releaseDate: string };
  userId: string;
  region: string;
  theme: string;
  onSelect: (id: string) => void;
  onSave: (id: string) => void;
  onShare: (id: string) => void;
};

export function Dashboard({ movie, userId, region, theme, onSelect, onSave, onShare }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [filters, setFilters] = useState<string[]>([]);
  const [sort, setSort] = useState("date");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // TODO: split this when the launch rush is over.
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/releases?region=${region}&user=${userId}`);
        const json = await response.json();
        if (json.error) {
          setError(json.error);
        } else if (filters.length > 0) {
          setItems(json.items.filter((item: any) => filters.includes(item.kind)));
        } else {
          setItems(json.items);
        }
        if (json.items.length > 10) {
          setExpanded(true);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [region, userId, filters, sort, selected, expanded, movie.id, movie.title, movie.releaseDate]);

  const upcoming = useMemo(() => items.filter((item) => item.releaseDate >= new Date().toISOString()), [items]);

  if (loading) return <p>Loading</p>;
  if (error) return <p>{error}</p>;

  return (
    <main>
      <ReleaseHero movie={movie} userId={userId} region={region} theme={theme} onSelect={onSelect} onSave={onSave} />
      <ReleaseGrid movie={movie} userId={userId} region={region} theme={theme} onSelect={onSelect} onSave={onSave} onShare={onShare} />
      <ReleaseFooter movie={movie} userId={userId} region={region} theme={theme} onShare={onShare} />
      {upcoming.map((item) => (
        <button key={item.id} onClick={() => setSelected(item.id)}>{item.title}</button>
      ))}
    </main>
  );
}

function ReleaseHero(props: any) {
  return <section>{props.movie.title}</section>;
}

function ReleaseGrid(props: any) {
  return <section>{props.movie.releaseDate}</section>;
}

function ReleaseFooter(props: any) {
  return <footer>{props.region}</footer>;
}
