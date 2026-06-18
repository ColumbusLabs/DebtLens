/**
 * Built-in UI primitives that are PascalCase but are *not* user-defined child
 * components. Forwarding props to these (e.g. `onPress` to a `Pressable`, `style` to a
 * `View`) is ordinary composition, not prop drilling. Covers React Native core plus the
 * common icon/gradient/blur libraries used across the RN/Expo ecosystem.
 */
export const REACT_NATIVE_CORE_HOST_COMPONENTS = new Set<string>([
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
]);

export const REACT_NATIVE_HOST_COMPONENT_ROOTS = new Set<string>([
  "Animated",
]);

export const HOST_COMPONENTS = new Set<string>([
  // React Native core
  ...REACT_NATIVE_CORE_HOST_COMPONENTS,
  ...REACT_NATIVE_HOST_COMPONENT_ROOTS,
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
 * 
 * @param tagName - The JSX tag name to check
 * @param customIgnoreComponents - Optional array of additional component names to treat as host primitives
 */
export function isHostComponent(tagName: string, customIgnoreComponents?: string[]): boolean {
  const base = tagName.split(".").pop() ?? tagName;
  const allComponents = customIgnoreComponents
    ? new Set([...HOST_COMPONENTS, ...customIgnoreComponents])
    : HOST_COMPONENTS;
  return allComponents.has(base) || allComponents.has(tagName);
}
