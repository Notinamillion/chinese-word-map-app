import { registerRootComponent } from 'expo';
import { Alert, Platform } from 'react-native';

import App from './App';

// react-native-web's Alert.alert is a no-op, so map it to browser dialogs.
// shortcut: window.confirm only offers OK/Cancel; 2-choice alerts map OK→first choice, Cancel→the other. Build a modal if 3+ choices appear.
if (Platform.OS === 'web') {
  Alert.alert = (title, message, buttons = []) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    if (buttons.length < 2) {
      window.alert(text);
      buttons[0]?.onPress?.();
      return;
    }
    const cancel = buttons.find(b => b.style === 'cancel') || buttons[buttons.length - 1];
    const ok = buttons.find(b => b !== cancel);
    const ask = `${text}\n\nOK = ${ok.text}, Cancel = ${cancel.text}`;
    (window.confirm(ask) ? ok : cancel).onPress?.();
  };
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
