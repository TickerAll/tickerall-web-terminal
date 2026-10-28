import { getBranding, isDefaultBrand, type Branding } from '../branding';

/**
 * The toolbar wordmark. Default (no partner brand stamped) = TickerAll's house style:
 * "TICKER" + an [ALL!] pill (the split-pill typography is TickerAll-specific, so partners
 * never get it). A partner brand renders neutrally — a supplied logo image (a `data:` URI)
 * if present, else the product name as a single styled word, optionally tinted by `logoColor`.
 *
 * The `.logo-word` class is reused for the partner word so the per-theme wordmark-colour
 * overrides (winxp/nextstep/platinum/… in index.html) still apply; an explicit `logoColor`
 * is an inline style, which wins over those class rules when a partner wants a fixed colour.
 *
 * `brand` / `isDefault` are optional overrides for the preview + test harness; production
 * renders `<BrandLogo />` and reads the host-stamped branding off `<html>`.
 */
export function BrandLogo({ brand = getBranding(), isDefault = isDefaultBrand() }: {
  brand?: Branding;
  isDefault?: boolean;
} = {}) {
  if (brand.logoDataUri) return <img className="logo-img" src={brand.logoDataUri} alt={brand.productName} />;
  if (isDefault) return <><span className="logo-word">TICKER</span><span className="logo-pill">ALL!</span></>;
  return <span className="logo-word" style={brand.logoColor ? { color: brand.logoColor } : undefined}>{brand.productName}</span>;
}
