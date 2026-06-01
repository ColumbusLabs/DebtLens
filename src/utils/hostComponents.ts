/**
 * Built-in UI primitives that are PascalCase but are *not* user-defined child
 * components. Forwarding props to these (e.g. `onPress` to a `Pressable`, `style` to a
 * `View`) is ordinary composition, not prop drilling. Covers React Native core plus the
 * common icon/gradient/blur libraries used across the RN/Expo ecosystem.
 */
export const HOST_COMPONENTS = new Set<string>([
  // React Native core
  "View",
  "Text",
  "Image",
  "ImageBackground",
  "ScrollView",
  "FlatList",
  "SectionList",
  "VirtualizedList",
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
  "TextInput",
  "Switch",
  "Modal",
  "ActivityIndicator",
  "Button",
  "RefreshControl",
  "StatusBar",
  "SafeAreaView",
  "KeyboardAvoidingView",
  "Animated",
  // Common ecosystem libraries
  "LinearGradient",
  "BlurView",
  "MaterialIcons",
  "MaterialCommunityIcons",
  "Ionicons",
  "Feather",
  "FontAwesome",
  "FontAwesome5",
  "AntDesign",
  "Entypo",
  "Octicons",
  "SimpleLineIcons",
  "Fontisto",
  "Foundation",
  "Zocial",
]);

/**
 * Returns true if a JSX tag name refers to a host primitive (so it should be ignored
 * as a "child component"). Handles namespaced tags like `Animated.View`.
 */
export function isHostComponent(tagName: string): boolean {
  const base = tagName.split(".").pop() ?? tagName;
  return HOST_COMPONENTS.has(base) || HOST_COMPONENTS.has(tagName);
}
