// Side-effect imports: the Liquid stylesheets. Every rule in them is scoped
// under `body.prinny-liquid`, so loading them changes nothing until the class
// is on <body> (AuthRouteThemeManager / UnAuthRouteThemeManager).
import './LiquidTokens.css';
import './LiquidComponents.css';
import './LiquidShell.css';
