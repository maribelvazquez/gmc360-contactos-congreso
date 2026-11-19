import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Personas del equipo que pueden capturar (el correo identifica quién capturó).
const EQUIPO: Record<string, string> = {
  miguel: "miguel@gmc360.com.mx",
  samara: "samara@gmc360.com.mx",
  amanda: "amanda@gmc360.com.mx",
  arely: "arely@gmc360.com.mx",
  claudia: "claudia@gmc360.com.mx",
  yadira: "yadira@gmc360.com.mx",
  vanessa: "vanessa@gmc360.com.mx",
  mariana: "mdiaz@gmc360.com.mx",
  maribel: "mvazquez@gmc360.com.mx",
};
const CORREOS = new Set(Object.values(EQUIPO));

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const txt = (v: unknown, max = 200) =>
  String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

const lista = (v: unknown, max = 12, len = 60) =>
  Array.isArray(v) ? v.slice(0, max).map((x) => txt(x, len)).filter(Boolean) : [];

const store = (name: string) => getStore({ name, consistency: "strong" });

function autorizado(req: Request, url: URL): boolean {
  const esperada = Netlify.env.get("ACCESS_KEY");
  if (!esperada) return false;
  const k = req.headers.get("x-gmc-key") || url.searchParams.get("k") || "";
  return k === esperada;
}

function limpiarLead(raw: any, capturadoPor: string, origen: "equipo" | "qr") {
  const nombre = txt(raw?.nombre, 120);
  if (!nombre) return null;
  const id = /^[A-Za-z0-9-]{8,64}$/.test(String(raw?.id || "")) ? String(raw.id) : crypto.randomUUID();
  const temp = ["caliente", "tibio", "frio"].includes(raw?.temperatura) ? raw.temperatura : "tibio";
  return {
    id,
    creadoEn: txt(raw?.creadoEn, 40) || new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
    capturadoPor,
    origen,
    nombre,
    empresa: txt(raw?.empresa, 120),
    cargo: txt(raw?.cargo, 120),
    pais: txt(raw?.pais, 60),
    correo: txt(raw?.correo, 120),
    whatsapp: txt(raw?.whatsapp, 30),
    temas: lista(raw?.temas),
    temperatura: temp,
    pasos: lista(raw?.pasos, 8, 60),
    nota: txt(raw?.nota, 1500),
    consentimiento: raw?.consentimiento === true,
    tieneFoto: false,
  };
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const metodo = req.method;

  try {
    // ---------- públicas ----------
    if (ruta === "registro" && metodo === "POST") {
      const raw = await req.json().catch(() => null);
      if (!raw || typeof raw !== "object") return json({ ok: false, error: "datos" }, 400);
      if (txt(raw.sitio)) return json({ ok: true }); // trampa para bots
      const dueño = EQUIPO[txt(raw.slug, 30)];
      if (!dueño) return json({ ok: false, error: "tarjeta" }, 400);
      if (raw.consentimiento !== true) return json({ ok: false, error: "consentimiento" }, 400);
      const lead: any = limpiarLead({ ...raw, id: undefined, nota: "", pasos: [] }, dueño, "qr");
      if (!lead) return json({ ok: false, error: "nombre" }, 400);
      if (!lead.correo && !lead.whatsapp) return json({ ok: false, error: "contacto" }, 400);
      lead.consentimiento = true;
      await store("leads").setJSON(lead.id, lead);
      return json({ ok: true, id: lead.id });
    }

    if (ruta === "libro" && metodo === "GET") {
      const archivo = txt(url.searchParams.get("f"), 120);
      if (!/^[A-Za-z0-9_\-. ]+\.(pdf|epub)$/i.test(archivo)) return new Response("No encontrado", { status: 404 });
      const registro = {
        archivo,
        lead: txt(url.searchParams.get("id"), 64),
        en: new Date().toISOString(),
      };
      await store("descargas").setJSON(`${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, registro);
      return new Response(null, { status: 302, headers: { location: `/libros/${encodeURIComponent(archivo)}` } });
    }

    if (ruta === "manifest" && metodo === "GET") {
      if (!autorizado(req, url)) return json({ ok: false }, 401);
      const k = url.searchParams.get("k") || "";
      return new Response(
        JSON.stringify({
          name: "GMC360 · Contactos del congreso",
          short_name: "GMC360",
          start_url: `/?k=${encodeURIComponent(k)}`,
          scope: "/",
          display: "standalone",
          background_color: "#1b1b1e",
          theme_color: "#1b1b1e",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        }),
        { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } }
      );
    }

    // ---------- solo equipo (requieren la llave) ----------
    if (!autorizado(req, url)) return json({ ok: false, error: "llave" }, 401);

    if (ruta === "ping") return json({ ok: true });

    if (ruta === "leads" && metodo === "GET") {
      const s = store("leads");
      const { blobs } = await s.list();
      const out: any[] = [];
      for (let i = 0; i < blobs.length; i += 25) {
        const lote = await Promise.all(blobs.slice(i, i + 25).map((b) => s.get(b.key, { type: "json" })));
        for (const l of lote) if (l) out.push(l);
      }
      out.sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn)));
      const d = await store("descargas").list();
      return json({ ok: true, leads: out, descargas: d.blobs.length });
    }

    if (ruta === "leads" && metodo === "POST") {
      const usuario = txt(req.headers.get("x-gmc-user"), 120).toLowerCase();
      if (!CORREOS.has(usuario)) return json({ ok: false, error: "usuario" }, 403);
      const body: any = await req.json().catch(() => null);
      const entrada = Array.isArray(body?.leads) ? body.leads.slice(0, 20) : [];
      const s = store("leads");
      const guardados: string[] = [];
      for (const raw of entrada) {
        const lead: any = limpiarLead(raw, usuario, "equipo");
        if (!lead) continue;
        const previo: any = await s.get(lead.id, { type: "json" });
        if (previo) {
          lead.capturadoPor = previo.capturadoPor;
          lead.creadoEn = previo.creadoEn;
          lead.tieneFoto = !!previo.tieneFoto;
        }
        if (typeof raw?.foto === "string" && raw.foto.startsWith("data:image/jpeg;base64,") && raw.foto.length < 2_500_000) {
          await store("fotos").set(lead.id, raw.foto);
          lead.tieneFoto = true;
        }
        await s.setJSON(lead.id, lead);
        guardados.push(lead.id);
      }
      return json({ ok: true, guardados });
    }

    if (ruta === "leads" && metodo === "DELETE") {
      const usuario = txt(req.headers.get("x-gmc-user"), 120).toLowerCase();
      if (!CORREOS.has(usuario)) return json({ ok: false, error: "usuario" }, 403);
      const id = txt(url.searchParams.get("id"), 64);
      const s = store("leads");
      const previo: any = await s.get(id, { type: "json" });
      if (!previo) return json({ ok: true });
      // Sólo quien lo capturó o Maribel pueden eliminarlo.
      if (previo.capturadoPor !== usuario && usuario !== EQUIPO.maribel) return json({ ok: false, error: "permiso" }, 403);
      await s.delete(id);
      await store("fotos").delete(id);
      return json({ ok: true });
    }

    if (ruta === "foto" && metodo === "GET") {
      const id = txt(url.searchParams.get("id"), 64);
      const f = await store("fotos").get(id);
      if (!f) return new Response("No encontrada", { status: 404 });
      const bin = Uint8Array.from(atob(f.split(",")[1]), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
    }

    return json({ ok: false, error: "no existe" }, 404);
  } catch (e) {
    console.error("api error", ruta, e);
    return json({ ok: false, error: "servidor" }, 500);
  }
};

export const config: Config = { path: "/api/*" };
