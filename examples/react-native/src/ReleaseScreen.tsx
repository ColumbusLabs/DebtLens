import React, { useState } from "react";
import { Text, View } from "react-native";

export function ReleaseScreen() {
  const [movie] = useState(null);
  const [film] = useState(null);
  const [show] = useState(null);
  const [series] = useState(null);
  const [game] = useState(null);
  const [title] = useState(null);
  const [release] = useState(null);

  return (
    <View>
      <Text>{String(movie || film || show || series || game || title || release)}</Text>
    </View>
  );
}
