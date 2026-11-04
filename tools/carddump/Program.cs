using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Options;
using CUE4Parse_Conversion.Textures;

namespace carddump;

internal static class Program
{
    private static string _paks = @"C:\Riot Games\VALORANT\live\ShooterGame\Content\Paks";
    private static string _out = @"D:\Projects\assist\official playercards";
    private static string _mode = "list";
    private static string _object = "";
    private static string _filter = "Personalization/PlayerCards/";
    private static string _game = "GAME_Valorant";
    private static int _limit = int.MaxValue;
    private static string _file = "";
    private static long _offset = -1;
    private static int _width;
    private static int _height;
    private static string _format = "BC1";
    private static int _size = -1;
    private static int _cols;
    private static int _rows;
    private static int _fps = 30;

    private sealed class EmptyMappings : CUE4Parse.MappingsProvider.ITypeMappingsProvider
    {
        public CUE4Parse.MappingsProvider.TypeMappings MappingsForGame { get; } = new();
        public void Load(string path, StringComparer comparer = null) { }
        public void Load(byte[] bytes, StringComparer comparer = null) { }
        public void Reload() { }
    }

    private static int Main(string[] args)
    {
        for (var i = 0; i < args.Length; i++)
        {
            var a = args[i];
            string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{a} needs a value");
            switch (a)
            {
                case "--paks": _paks = Next(); break;
                case "--out": _out = Next(); break;
                case "--mode": _mode = Next(); break;
                case "--object": _object = Next(); break;
                case "--filter": _filter = Next(); break;
                case "--game": _game = Next(); break;
                case "--limit": _limit = int.Parse(Next()); break;
                case "--file": _file = Next(); break;
                case "--offset": _offset = long.Parse(Next()); break;
                case "--width": _width = int.Parse(Next()); break;
                case "--height": _height = int.Parse(Next()); break;
                case "--format": _format = Next(); break;
                case "--size": _size = int.Parse(Next()); break;
                case "-h": case "--help":
                    Console.WriteLine("--paks <dir> --out <dir> --mode list|inspect|export|raw|scan|survey|sheets|extract|grid|seams|animate --object <pkg> --filter <substr> --game <EGame> --limit <n> --file <png> --cols <n> --rows <n> --fps <n>");
                    return 0;
                case "--cols": _cols = int.Parse(Next()); break;
                case "--rows": _rows = int.Parse(Next()); break;
                case "--fps": _fps = int.Parse(Next()); break;
                default:
                    Console.Error.WriteLine($"unknown arg {a}");
                    return 2;
            }
        }

        var egame = Enum.Parse<EGame>(_game);
        if (_mode == "api")
        {
            PrintApi();
            return 0;
        }

        if (_mode == "dxt")
        {
            return Dxt();
        }

        if (_mode == "selftest")
        {
            return SelfTest();
        }

        if (_mode == "grid")
        {
            return Grid();
        }

        if (_mode == "seams")
        {
            return Seams();
        }

        if (_mode == "animate")
        {
            return Animate();
        }

        Console.WriteLine($"[i] engine: {egame}");
        Console.WriteLine($"[i] paks  : {_paks}");
        Console.WriteLine($"[i] mode  : {_mode}");

        var provider = new DefaultFileProvider(
            new DirectoryInfo(_paks),
            SearchOption.TopDirectoryOnly,
            new VersionContainer(egame),
            StringComparer.OrdinalIgnoreCase);

        try
        {
            provider.Initialize();
            provider.SubmitKey(new FGuid(), new FAesKey(new string('0', 64)));
            provider.MappingsContainer = new EmptyMappings();
            Console.WriteLine($"[i] mounted, {provider.Files.Count} files indexed");
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"[x] mount failed: {e.GetType().Name}: {e.Message}");
            return 3;
        }

        switch (_mode)
        {
            case "list": return List(provider);
            case "inspect": return Inspect(provider);
            case "export": return Export(provider);
            case "probe": return Probe(provider);
            case "dump": return Dump(provider);
            case "probe2": return Probe2(provider);
            case "meta": return Meta(provider);
            case "savepkg": return SavePkg(provider);
            case "scan": return Scan(provider);
            case "raw": return Raw(provider);
            case "survey": return Survey(provider);
            case "sheets": return Sheets(provider);
            case "extract": return Extract(provider);
            case "tex": return Tex(provider);
            default:
                Console.Error.WriteLine($"[x] unknown mode {_mode}");
                return 2;
        }
    }

    private static int SelfTest()
    {
        // 4x4 BC1 block: colour0 = pure red (R5G6B5 = 0xF800), colour1 = pure blue (0x001F), all indices 0
        var bc1 = new byte[] { 0x00, 0xF8, 0x1F, 0x00, 0x00, 0x00, 0x00, 0x00 };
        var out1 = CUE4Parse_Conversion.Textures.BC.BCDecoder.BC1(bc1, 4, 4, 1);
        Console.WriteLine($"BC1 first px: {out1[0]},{out1[1]},{out1[2]},{out1[3]} (expect 255,0,0,255)");

        // 4x4 BC3 block: alpha all 255, then colour0 red / colour1 blue, indices 0
        var bc3 = new byte[16];
        bc3[0] = 255; bc3[1] = 255;
        for (var i = 2; i < 8; i++) bc3[i] = 0;
        bc3[8] = 0x00; bc3[9] = 0xF8; bc3[10] = 0x1F; bc3[11] = 0x00;
        var out3 = CUE4Parse_Conversion.Textures.BC.BCDecoder.BC3(bc3, 4, 4, 1);
        Console.WriteLine($"BC3 first px: {out3[0]},{out3[1]},{out3[2]},{out3[3]} (expect 255,0,0,255)");

        // BC7 mode 6 block: solid opaque colour. Build via known-good sample is hard; skip.
        return 0;
    }

    private static int Grid()
    {
        using var img = SkiaSharp.SKImage.FromEncodedData(_file);
        if (img is null)
        {
            Console.Error.WriteLine("[x] cannot decode " + _file);
            return 6;
        }

        var cands = GridCandidates(img);
        var pick = PickGrid(img.Width, img.Height, cands);
        Console.WriteLine($"[i] {Path.GetFileName(_file)} {img.Width}x{img.Height}  PICK {pick.Cols}x{pick.Rows} = {pick.Cols * pick.Rows} frames of {(double) img.Width / pick.Cols:0.#}x{(double) img.Height / pick.Rows:0.#}");
        foreach (var c in cands.OrderBy(x => x.Diff * (1 + 2.5 * x.Prior)).Take(5))
            Console.WriteLine($"    {c.Cols,2}x{c.Rows,-2} n={c.Cols * c.Rows,3} frame={(double) img.Width / c.Cols,7:0.#}x{(double) img.Height / c.Rows,-7:0.#} aspect={c.Aspect,5:0.00} diff={c.Diff,6:0.00} prior={c.Prior:0.00}");
        return 0;
    }

    private sealed class GridCand
    {
        public int Cols;
        public int Rows;
        public double Diff;
        public double Aspect;
        public double Prior;
    }

    // Frames per sheet that were confirmed by eye / ink-gap analysis where the
    // content-based scorer is ambiguous (near-identical neighbouring frames).
    private static readonly Dictionary<string, (int Cols, int Rows)> GridOverrides = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Bloomline_Aggrobot_01_Sequence_01"] = (4, 4),
        ["Playercard_Bloomline_Nox_01_Sequence_01"] = (4, 4),
        ["PlayerCard_Poptoy_FlipBook"] = (4, 4),
        ["PlayerCards_AFTERGLOW3_01_Large_SpriteSheet"] = (6, 4),
        ["Playercard_Ghosty_Sequence_01"] = (5, 3),
        ["Playercard_Bloomline_Sprinter_00_Sequence_01"] = (4, 4),
        ["Playercard_Val5beta_L_Flipbook_Smoke_Full_1"] = (4, 6),
        ["val5beta_flipbook_L_1"] = (4, 4),
    };

    private static (int Cols, int Rows, string Source) ResolveGrid(string file, int w, int h, List<GridCand> cands)
    {
        var name = Path.GetFileNameWithoutExtension(file);
        if (GridOverrides.TryGetValue(name, out var o)) return (o.Cols, o.Rows, "override");
        var pick = PickGrid(w, h, cands);
        return (pick.Cols, pick.Rows, "auto");
    }

    private static List<GridCand> GridCandidates(SkiaSharp.SKImage img)
    {
        int W = img.Width, H = img.Height;
        var scale = Math.Min(1.0, 512.0 / Math.Max(W, H));
        var dw = Math.Max(16, (int) Math.Round(W * scale));
        var dh = Math.Max(16, (int) Math.Round(H * scale));
        using var bmp = new SkiaSharp.SKBitmap(new SkiaSharp.SKImageInfo(dw, dh, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Unpremul));
        using (var canvas = new SkiaSharp.SKCanvas(bmp))
        {
            using var paint = new SkiaSharp.SKPaint { IsAntialias = true };
            canvas.DrawImage(img, new SkiaSharp.SKRect(0, 0, dw, dh), paint);
        }

        var px = bmp.GetPixelSpan();
        var cands = new List<GridCand>();
        const double CardAspect = 268.0 / 640.0;

        for (var cols = 1; cols <= 24; cols++)
        {
            if ((double) W / cols < 96) break;
            for (var rows = 1; rows <= 24; rows++)
            {
                if ((double) H / rows < 96) break;
                var n = cols * rows;
                if (n < 2 || n > 160) continue;

                var sigs = new double[n][];
                for (var i = 0; i < n; i++)
                {
                    var c = i % cols;
                    var r = i / cols;
                    sigs[i] = Signature(px, dw, dh, (double) c * dw / cols, (double) r * dh / rows,
                        (double) (c + 1) * dw / cols, (double) (r + 1) * dh / rows);
                }

                double sum = 0;
                for (var i = 1; i < n; i++) sum += Dist(sigs[i - 1], sigs[i]);

                var aspect = ((double) W / cols) / ((double) H / rows);
                var prior = Math.Min(Math.Abs(Math.Log(aspect / CardAspect)), Math.Abs(Math.Log(aspect)));
                cands.Add(new GridCand { Cols = cols, Rows = rows, Diff = sum / (n - 1), Aspect = aspect, Prior = prior });
            }
        }

        return cands;
    }

    private static GridCand PickGrid(int W, int H, List<GridCand> cands)
    {
        // exact tiling of the card size wins outright
        foreach (var c in cands)
        {
            if (Math.Abs((double) W / c.Cols - 268) < 0.5 && Math.Abs((double) H / c.Rows - 640) < 0.5)
                return c;
        }

        return cands.OrderBy(x => x.Diff * (1 + 2.5 * x.Prior)).First();
    }

    private static int Animate()
    {
        using var img = SkiaSharp.SKImage.FromEncodedData(_file);
        if (img is null)
        {
            Console.Error.WriteLine("[x] cannot decode " + _file);
            return 6;
        }

        var cols = _cols;
        var rows = _rows;
        var src = "args";
        if (cols <= 0 || rows <= 0)
        {
            var g = ResolveGrid(_file, img.Width, img.Height, GridCandidates(img));
            cols = g.Cols;
            rows = g.Rows;
            src = g.Source;
        }

        var fw = (int) Math.Round((double) img.Width / cols);
        var fh = (int) Math.Round((double) img.Height / rows);
        var n = cols * rows;
        var dir = _out;
        var framesDir = Path.Combine(dir, "frames");
        Directory.CreateDirectory(framesDir);

        Console.WriteLine($"[i] {Path.GetFileName(_file)} {img.Width}x{img.Height} -> {cols}x{rows} = {n} frames of {fw}x{fh} ({src})");

        // keep an exact copy of the sheet
        File.Copy(_file, Path.Combine(dir, "sheet.png"), true);

        var frames = new List<byte[]>();
        using var fb = new SkiaSharp.SKBitmap(new SkiaSharp.SKImageInfo(fw, fh, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Unpremul));
        using var paint = new SkiaSharp.SKPaint { IsAntialias = true, FilterQuality = SkiaSharp.SKFilterQuality.High };

        for (var i = 0; i < n; i++)
        {
            var c = i % cols;
            var r = i / cols;
            var sx0 = (float) ((double) c * img.Width / cols);
            var sx1 = (float) ((double) (c + 1) * img.Width / cols);
            var sy0 = (float) ((double) r * img.Height / rows);
            var sy1 = (float) ((double) (r + 1) * img.Height / rows);

            using (var canvas = new SkiaSharp.SKCanvas(fb))
            {
                canvas.Clear(SkiaSharp.SKColors.Transparent);
                canvas.DrawImage(img, new SkiaSharp.SKRect(sx0, sy0, sx1, sy1), new SkiaSharp.SKRect(0, 0, fw, fh), paint);
                canvas.Flush();
            }

            var rgba = fb.GetPixelSpan().ToArray();
            frames.Add(rgba);

            using var fimg = SkiaSharp.SKImage.FromBitmap(fb);
            using var data = fimg.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
            File.WriteAllBytes(Path.Combine(framesDir, i.ToString("000") + ".png"), data.ToArray());
        }

        var apng = Path.Combine(dir, Path.GetFileName(dir).TrimEnd('\\') + ".apng");
        Apng.Write(apng, fw, fh, frames, _fps);
        Console.WriteLine($"[ok] {n} frames -> {apng}");
        return 0;
    }

    private static double EdgeAt(ReadOnlySpan<byte> px, int dw, int x, int y)
    {
        var a = (y * dw + x) * 4;
        var b = (y * dw + x - 1) * 4;
        return (Math.Abs(px[a] - px[b]) + Math.Abs(px[a + 1] - px[b + 1]) + Math.Abs(px[a + 2] - px[b + 2])) / 3.0;
    }

    private static double EdgeAtV(ReadOnlySpan<byte> px, int dw, int x, int y)
    {
        var a = (y * dw + x) * 4;
        var b = ((y - 1) * dw + x) * 4;
        return (Math.Abs(px[a] - px[b]) + Math.Abs(px[a + 1] - px[b + 1]) + Math.Abs(px[a + 2] - px[b + 2])) / 3.0;
    }

    private static double[] Signature(ReadOnlySpan<byte> px, int dw, int dh, double x0, double y0, double x1, double y1)
    {
        const int B = 4;
        var sig = new double[B * B * 3];
        var w = Math.Max(1, x1 - x0);
        var h = Math.Max(1, y1 - y0);
        for (var by = 0; by < B; by++)
        {
            for (var bx = 0; bx < B; bx++)
            {
                double r = 0, g = 0, b = 0;
                var count = 0;
                var sy = (int) (y0 + h * by / B);
                var ey = Math.Max(sy + 1, (int) (y0 + h * (by + 1) / B));
                var sx = (int) (x0 + w * bx / B);
                var ex = Math.Max(sx + 1, (int) (x0 + w * (bx + 1) / B));
                for (var y = sy; y < ey && y < dh; y++)
                {
                    for (var x = sx; x < ex && x < dw; x++)
                    {
                        var o = (y * dw + x) * 4;
                        r += px[o]; g += px[o + 1]; b += px[o + 2];
                        count++;
                    }
                }

                if (count == 0) count = 1;
                var k = (by * B + bx) * 3;
                sig[k] = r / count; sig[k + 1] = g / count; sig[k + 2] = b / count;
            }
        }

        return sig;
    }

    private static double Dist(double[] a, double[] b)
    {
        double s = 0;
        for (var i = 0; i < a.Length; i++) s += Math.Abs(a[i] - b[i]);
        return s / a.Length;
    }

    private static int Seams()
    {
        using var img = SkiaSharp.SKImage.FromEncodedData(_file);
        if (img is null) return 6;
        int W = img.Width, H = img.Height;
        using var bmp = new SkiaSharp.SKBitmap(new SkiaSharp.SKImageInfo(W, H, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Unpremul));
        using (var canvas = new SkiaSharp.SKCanvas(bmp)) canvas.DrawImage(img, 0, 0);
        var px = bmp.GetPixelSpan();

        var ce = new double[W];
        var ca = new double[W];
        for (var x = 1; x < W; x++)
        {
            double s = 0, a = 0;
            for (var y = 0; y < H; y++)
            {
                var o = (y * W + x) * 4;
                var p = (y * W + x - 1) * 4;
                s += (Math.Abs(px[o] - px[p]) + Math.Abs(px[o + 1] - px[p + 1]) + Math.Abs(px[o + 2] - px[p + 2])) / 3.0;
                a += px[o + 3];
            }
            ce[x] = s / H;
            ca[x] = a / H;
        }

        var re = new double[H];
        var ra = new double[H];
        for (var y = 1; y < H; y++)
        {
            double s = 0, a = 0;
            for (var x = 0; x < W; x++)
            {
                var o = (y * W + x) * 4;
                var p = ((y - 1) * W + x) * 4;
                s += (Math.Abs(px[o] - px[p]) + Math.Abs(px[o + 1] - px[p + 1]) + Math.Abs(px[o + 2] - px[p + 2])) / 3.0;
                a += px[o + 3];
            }
            re[y] = s / W;
            ra[y] = a / W;
        }

        Console.WriteLine($"[i] {Path.GetFileName(_file)} {W}x{H}");
        Console.WriteLine("  top column edges (x, edge, meanAlpha):");
        foreach (var x in Enumerable.Range(1, W - 1).OrderByDescending(i => ce[i]).Take(14))
            Console.WriteLine($"    x={x,5} ({100.0 * x / W,6:0.0}%)  edge={ce[x],7:0.00}  alpha={ca[x],6:0.1}");
        Console.WriteLine("  top row edges (y, edge, meanAlpha):");
        foreach (var y in Enumerable.Range(1, H - 1).OrderByDescending(i => re[i]).Take(14))
            Console.WriteLine($"    y={y,5} ({100.0 * y / H,6:0.0}%)  edge={re[y],7:0.00}  alpha={ra[y],6:0.1}");
        return 0;
    }

    private static void PrintApi()
    {
        var asm = typeof(AssetRipper.TextureDecoder.Bc.Bc1).Assembly;
        foreach (var t in asm.GetTypes().Where(t => t.Name.Contains("Rgba") || t.Name.Contains("Rgb24")))
        {
            Console.WriteLine("T " + t.FullName);
        }

        var dt = typeof(AssetRipper.TextureDecoder.Bc.Bc1).GetMethods().First(m => m.Name == "Decompress");
        foreach (var ga in dt.GetGenericArguments())
        {
            Console.WriteLine($"generic {ga.Name} constraints: " + string.Join(",", ga.GetGenericParameterConstraints().Select(c => c.FullName)));
        }
    }

    private static int Dxt()
    {
        var bytes = File.ReadAllBytes(_file);
        var off = _offset < 0 ? bytes.Length - _size : (int) _offset;
        var len = _size > 0 ? _size : bytes.Length - off;
        var src = new byte[len];
        Array.Copy(bytes, off, src, 0, len);
        Console.WriteLine($"[i] {_file}: {bytes.Length} bytes, using {len} from {off} as {_width}x{_height} {_format}");
        Console.WriteLine("    first 48: " + string.Join(' ', src.Take(48).Select(b => b.ToString("X2"))));

        var rgba = DecodeFormat(src, _width, _height, _format);
        if (rgba is null)
        {
            Console.Error.WriteLine("[x] decode failed");
            return 5;
        }

        using var bmp = new SkiaSharp.SKBitmap(_width, _height, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Unpremul);
        var handle = System.Runtime.InteropServices.GCHandle.Alloc(rgba, System.Runtime.InteropServices.GCHandleType.Pinned);
        try
        {
            bmp.InstallPixels(bmp.Info, handle.AddrOfPinnedObject(), bmp.RowBytes);
            using var img = SkiaSharp.SKImage.FromBitmap(bmp);
            using var data = img.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
            Directory.CreateDirectory(Path.Combine(_out, "_probe"));
            var outFile = Path.Combine(_out, "_probe", Path.GetFileNameWithoutExtension(_file) + ".png");
            File.WriteAllBytes(outFile, data.ToArray());
            Console.WriteLine($"[ok] -> {outFile} ({data.Size} bytes)");
        }
        finally
        {
            handle.Free();
        }

        return 0;
    }

    private static byte[] DecodeFormat(byte[] src, int w, int h, string fmt)
    {
        if (IsBlockFormat(fmt))
        {
            var f = fmt.Replace("PF_", "").Replace("DXT1", "BC1").Replace("DXT3", "BC2").Replace("DXT5", "BC3").ToUpperInvariant();
            return f switch
            {
                "BC1" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC1(src, w, h, 1),
                "BC2" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC2(src, w, h, 1),
                "BC3" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC3(src, w, h, 1),
                "BC4" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC4(src, w, h, 1),
                "BC5" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC5(src, w, h, 1),
                "BC7" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC7(src, w, h, 1),
                _ => null
            };
        }

        var n = w * h;
        var rgba = new byte[n * 4];
        switch (fmt)
        {
            case "PF_B8G8R8A8":
            case "PF_A8R8G8B8":
                for (var i = 0; i < n; i++)
                {
                    rgba[i * 4 + 0] = src[i * 4 + 2];
                    rgba[i * 4 + 1] = src[i * 4 + 1];
                    rgba[i * 4 + 2] = src[i * 4 + 0];
                    rgba[i * 4 + 3] = src[i * 4 + 3];
                }
                return rgba;
            case "PF_R8G8B8A8":
                Array.Copy(src, rgba, Math.Min(src.Length, rgba.Length));
                return rgba;
            case "PF_G8":
                for (var i = 0; i < n; i++)
                {
                    var g = src[i];
                    rgba[i * 4 + 0] = g; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = 255;
                }
                return rgba;
            case "PF_A8":
                for (var i = 0; i < n; i++)
                {
                    rgba[i * 4 + 0] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = src[i];
                }
                return rgba;
        }

        return null;
    }

    private static IEnumerable<string> CardPackages(IFileProvider provider)
        => provider.Files.Keys
            .Where(k => k.Contains(_filter, StringComparison.OrdinalIgnoreCase) && k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase);

    private static int List(IFileProvider provider)
    {
        var all = CardPackages(provider).ToList();
        Console.WriteLine($"[i] {all.Count} packages under {_filter}");
        var names = all.Select(p => p[..^".uasset".Length]).ToList();
        var primaries = names.Where(n => n.EndsWith("_PrimaryAsset", StringComparison.OrdinalIgnoreCase)).ToList();
        Console.WriteLine($"[i] {primaries.Count} primary assets");
        foreach (var n in all.Take(20)) Console.WriteLine("    " + n);

        if (!string.IsNullOrEmpty(_object))
        {
            var hit = names.FirstOrDefault(n => n.Contains(_object, StringComparison.OrdinalIgnoreCase));
            Console.WriteLine(hit is null ? "[x] no match" : "[ok] " + hit);
        }

        return 0;
    }

    private static int Inspect(IFileProvider provider)
    {
        if (string.IsNullOrEmpty(_object))
        {
            Console.Error.WriteLine("[x] --object required");
            return 2;
        }

        UObject obj;
        try
        {
            obj = provider.LoadPackageObject(_object);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"[x] load failed: {e.GetType().Name}: {e.Message}");
            return 4;
        }

        if (obj is null)
        {
            Console.Error.WriteLine("[x] object is null");
            return 4;
        }

        Console.WriteLine($"[ok] {obj.GetType().Name}  ({obj.ExportType})  props={obj.Properties.Count}");
        foreach (var prop in obj.Properties)
        {
            var line = "    " + prop.Name.Text;
            try
            {
                var val = obj.GetOrDefault<object>(prop.Name.Text);
                line += " = " + Describe(val);
            }
            catch (Exception e)
            {
                line += " = <" + e.GetType().Name + ">";
            }

            Console.WriteLine(line);
        }

        return 0;
    }

    private static string Describe(object v)
    {
        switch (v)
        {
            case null: return "null";
            case UObject o: return $"{o.ExportType}::{o.Name}";
            case string s: return "\"" + s + "\"";
            case System.Collections.IEnumerable e when v is not string:
                var parts = new List<string>();
                foreach (var item in e) parts.Add(Describe(item));
                return "[" + string.Join(", ", parts.Take(12)) + (parts.Count > 12 ? ", ..." : "") + "]";
            default: return v.ToString();
        }
    }

    private static int Dump(IFileProvider provider)
    {
        var data = provider.SaveAsset(_object);
        Directory.CreateDirectory(Path.Combine(_out, "_probe"));
        var file = Path.Combine(_out, "_probe", Path.GetFileName(_object) + ".bin");
        File.WriteAllBytes(file, data);
        Console.WriteLine($"[ok] {data.Length} bytes -> {file}");
        return 0;
    }

    private static void ClearUnversionedFlag(CUE4Parse.UE4.Assets.IPackage pkg)
    {
        const int PKG_UnversionedProperties = 0x00002000;
        var t = pkg.GetType();
        var field = t.GetField("<Summary>k__BackingField", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        if (field is null)
        {
            Console.WriteLine("[!] summary field not found");
            return;
        }

        var boxed = field.GetValue(pkg);
        var flagsField = boxed.GetType().GetField("PackageFlags");
        if (flagsField is null)
        {
            Console.WriteLine("[!] PackageFlags field not found");
            return;
        }

        var raw = Convert.ToUInt32(flagsField.GetValue(boxed));
        var cleared = raw & ~(uint) PKG_UnversionedProperties;
        Console.WriteLine($"[i] package flags before: 0x{raw:X8}");
        flagsField.SetValue(boxed, Enum.ToObject(flagsField.FieldType, cleared));
        field.SetValue(pkg, boxed);
        Console.WriteLine($"[i] package flags after : 0x{Convert.ToUInt32(flagsField.GetValue(field.GetValue(pkg))):X8}");
    }

    internal sealed class TexInfo
    {
        public string Path;
        public int Width;
        public int Height;
        public string Format;
        public int MipCount;
        public int PayloadOffset;
        public int PayloadLength;
        public byte[] Raw;
    }

    private static long MipBytes(int w, int h, string fmt) => fmt switch
    {
        "PF_DXT1" or "PF_BC1" or "PF_BC4" => (long) ((w + 3) / 4) * ((h + 3) / 4) * 8,
        "PF_DXT3" or "PF_DXT5" or "PF_BC2" or "PF_BC3" or "PF_BC5" or "PF_BC6H" or "PF_BC7"
            => (long) ((w + 3) / 4) * ((h + 3) / 4) * 16,
        "PF_B8G8R8A8" or "PF_R8G8B8A8" or "PF_A8R8G8B8" => (long) w * h * 4,
        "PF_G8" or "PF_A8" => (long) w * h,
        "PF_FloatRGBA" or "PF_R16G16B16A16_FLOAT" or "PF_R16G16B16A16_UNORM" => (long) w * h * 8,
        "PF_R32_FLOAT" => (long) w * h * 4,
        _ => -1
    };

    private static bool IsBlockFormat(string fmt) => fmt is "PF_DXT1" or "PF_BC1" or "PF_BC4"
        or "PF_DXT3" or "PF_DXT5" or "PF_BC2" or "PF_BC3" or "PF_BC5" or "PF_BC6H" or "PF_BC7";

    private static long ChainSize(int w, int h, string fmt, int mips)
    {
        if (MipBytes(w, h, fmt) < 0) return -1;
        long total = 0;
        for (var i = 0; i < mips; i++)
        {
            var b = MipBytes(Math.Max(1, w >> i), Math.Max(1, h >> i), fmt);
            if (b < 0) return -1;
            total += b;
        }
        return total;
    }

    private static TexInfo Analyze(IFileProvider provider, string path)
    {
        var pkg = provider.LoadPackage(path);
        var raw = provider.SaveAsset(path);
        if (raw.Length < 64) return null;

        int headerSize;
        long exportSize;
        if (pkg is CUE4Parse.UE4.Assets.IoPackage io && io.ExportMap.Length > 0)
        {
            headerSize = (int) BitConverter.ToUInt32(raw, 4);
            exportSize = (long) io.ExportMap[0].CookedSerialSize;
        }
        else return null;

        var names = io.NameMap;
        var start = Math.Clamp(headerSize, 0, raw.Length - 16);
        var end = (int) Math.Min(raw.Length - 16, headerSize + exportSize);

        for (var off = start; off < end; off++)
        {
            var v = BitConverter.ToUInt32(raw, off);
            if ((v >> 30) != 0) continue;
            var idx = v & 0x3FFFFFFF;
            if (idx >= names.Length) continue;
            var nm = names[idx].Name;
            if (nm is null || !nm.StartsWith("PF_")) continue;

            try
            {
                var skip = BitConverter.ToInt64(raw, off + 8);
                var dataEnd = off + 16 + skip;
                if (skip <= 0 || dataEnd > raw.Length) continue;

                var p = off + 16;
                if (raw[p] != 0) continue;                       // bUsingDerivedData
                var sx = BitConverter.ToInt32(raw, p + 16);
                var sy = BitConverter.ToInt32(raw, p + 20);
                var packed = BitConverter.ToUInt32(raw, p + 24);
                if (sx < 4 || sy < 4 || sx > 8192 || sy > 8192) continue;
                if ((packed & 0x3FFFFFFF) != 1) continue;

                var strLen = BitConverter.ToInt32(raw, p + 28);
                if (strLen < 4 || strLen > 32) continue;
                var fmtStr = System.Text.Encoding.ASCII.GetString(raw, p + 32, strLen).TrimEnd('\0');
                if (fmtStr != nm) continue;

                var firstMip = BitConverter.ToInt32(raw, p + 32 + strLen);
                if (firstMip != 0) continue;
                var mipCount = BitConverter.ToInt32(raw, p + 36 + strLen);
                if (mipCount < 1 || mipCount > 20) continue;

                var chain = ChainSize(sx, sy, nm, mipCount);
                if (chain <= 0) continue;

                // The mip record ends with [SizeX][SizeY][SizeZ] followed by 12 zero bytes.
                var payloadEnd = (int) (dataEnd - 24);
                var hasTail = payloadEnd >= 0 && payloadEnd + 12 <= raw.Length
                              && BitConverter.ToInt32(raw, payloadEnd) == sx
                              && BitConverter.ToInt32(raw, payloadEnd + 4) == sy
                              && BitConverter.ToInt32(raw, payloadEnd + 8) == 1;
                if (!hasTail) payloadEnd = (int) dataEnd;

                var payloadOffset = payloadEnd - (int) chain;
                if (payloadOffset < p || payloadOffset + chain > raw.Length) continue;

                return new TexInfo
                {
                    Path = path,
                    Width = sx,
                    Height = sy,
                    Format = nm,
                    MipCount = mipCount,
                    PayloadOffset = payloadOffset,
                    PayloadLength = (int) chain,
                    Raw = raw
                };
            }
            catch
            {
                // keep scanning
            }
        }

        return null;
    }

    private static void WritePng(byte[] rgba, int w, int h, string outFile)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(outFile)!);
        using var bmp = new SkiaSharp.SKBitmap(w, h, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Unpremul);
        var handle = System.Runtime.InteropServices.GCHandle.Alloc(rgba, System.Runtime.InteropServices.GCHandleType.Pinned);
        try
        {
            bmp.InstallPixels(bmp.Info, handle.AddrOfPinnedObject(), bmp.RowBytes);
            using var img = SkiaSharp.SKImage.FromBitmap(bmp);
            using var data = img.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
            File.WriteAllBytes(outFile, data.ToArray());
        }
        finally
        {
            handle.Free();
        }
    }

    private static bool IsLargeCardName(string baseName)
    {
        if (baseName.Contains("Mask", StringComparison.OrdinalIgnoreCase) ||
            baseName.Contains("LUT", StringComparison.OrdinalIgnoreCase))
            return false;

        // Large card art is not named consistently: _L, _L1, _L2, _Large, _large, _L_A, SovereignL1
        if (System.Text.RegularExpressions.Regex.IsMatch(baseName, @"_L$|_L\d+$|_Large$|_L_[A-Za-z0-9]+$",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            return true;

        return System.Text.RegularExpressions.Regex.IsMatch(baseName, @"[a-z]L\d+$");
    }

    private static int Extract(IFileProvider provider)
    {
        var all = provider.Files.Keys
            .Where(k => k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.Contains("Personalization/PlayerCards/", StringComparison.OrdinalIgnoreCase))
            .Where(k => string.IsNullOrEmpty(_filter) || _filter == "Personalization/PlayerCards/"
                ? IsLargeCardName(Path.GetFileNameWithoutExtension(k))
                : k.Contains(_filter, StringComparison.OrdinalIgnoreCase))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();

        Console.WriteLine($"[i] {all.Count} candidate textures");
        var ok = 0;
        var fail = 0;
        var failures = new List<string>();
        var dupes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var dir = Path.Combine(_out, "_stage");

        foreach (var t in all.Take(_limit))
        {
            TexInfo info;
            try
            {
                info = Analyze(provider, t);
            }
            catch (Exception e)
            {
                fail++;
                failures.Add($"{t} :: {e.GetType().Name}: {e.Message}");
                continue;
            }

            if (info is null)
            {
                fail++;
                failures.Add(t);
                continue;
            }

            var mip0 = (int) MipBytes(info.Width, info.Height, info.Format);
            if (mip0 <= 0 || info.PayloadOffset + mip0 > info.Raw.Length)
            {
                fail++;
                failures.Add($"{t} :: size mismatch {info.Width}x{info.Height} {info.Format}");
                continue;
            }

            var src = new byte[mip0];
            Array.Copy(info.Raw, info.PayloadOffset, src, 0, mip0);
            var rgba = DecodeFormat(src, info.Width, info.Height, info.Format);
            if (rgba is null)
            {
                fail++;
                failures.Add($"{t} :: unsupported {info.Format}");
                continue;
            }

            var sub = t.Replace("ShooterGame/Content/Personalization/PlayerCards/", "").Replace('/', '\\');
            var outFile = Path.Combine(dir, Path.ChangeExtension(sub, ".png"));
            dupes[outFile] = dupes.GetValueOrDefault(outFile) + 1;
            if (dupes[outFile] > 1) outFile = outFile.Replace(".png", $"__{dupes[outFile]}.png");

            WritePng(rgba, info.Width, info.Height, outFile);
            ok++;
        }

        Console.WriteLine($"[i] done ok={ok} fail={fail}");
        foreach (var f in failures.Take(30)) Console.WriteLine("  FAIL " + f);
        if (failures.Count > 30) Console.WriteLine($"  ... {failures.Count - 30} more");
        return 0;
    }

    private static int Sheets(IFileProvider provider)
    {
        var textures = provider.Files.Keys
            .Where(k => k.Contains("Personalization/PlayerCards/", StringComparison.OrdinalIgnoreCase)
                        && k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .Where(k => k.Contains("flipbook", StringComparison.OrdinalIgnoreCase) || k.Contains("sheet", StringComparison.OrdinalIgnoreCase))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();

        Console.WriteLine($"[i] {textures.Count} flipbook/sheet assets");
        foreach (var t in textures.Take(_limit))
        {
            var info = Analyze(provider, t);
            var folder = Path.GetDirectoryName(t)!.Replace("ShooterGame/Content/Personalization/PlayerCards/", "");
            if (info is null)
            {
                Console.WriteLine($"[x] {folder} :: {Path.GetFileNameWithoutExtension(t)}");
                continue;
            }

            Console.WriteLine($"[ok] {folder} :: {Path.GetFileNameWithoutExtension(t)} {info.Width}x{info.Height} {info.Format} mips={info.MipCount}");
        }

        return 0;
    }

    private static int Survey(IFileProvider provider)
    {
        var textures = provider.Files.Keys
            .Where(k => k.Contains("Personalization/PlayerCards/", StringComparison.OrdinalIgnoreCase)
                        && k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .Where(k => Path.GetFileNameWithoutExtension(k).EndsWith("_L", StringComparison.OrdinalIgnoreCase))
            .ToList();

        Console.WriteLine($"[i] {textures.Count} _L textures");
        var ok = 0;
        var fail = 0;
        var formats = new Dictionary<string, int>();
        var dims = new Dictionary<string, int>();
        foreach (var t in textures.Take(_limit))
        {
            var info = Analyze(provider, t);
            if (info is null) { fail++; if (fail <= 10) Console.WriteLine($"[x] {t}"); continue; }
            ok++;
            Console.WriteLine($"    {Path.GetFileNameWithoutExtension(t)}: {info.Width}x{info.Height} {info.Format} mips={info.MipCount}");
            formats[info.Format] = formats.GetValueOrDefault(info.Format) + 1;
            var key = $"{info.Width}x{info.Height} mips={info.MipCount}";
            dims[key] = dims.GetValueOrDefault(key) + 1;
        }

        Console.WriteLine($"[i] analysis ok={ok} fail={fail}");
        foreach (var kv in formats.OrderByDescending(k => k.Value)) Console.WriteLine($"    {kv.Key}: {kv.Value}");
        foreach (var kv in dims.OrderByDescending(k => k.Value).Take(10)) Console.WriteLine($"    {kv.Key}: {kv.Value}");
        return 0;
    }

    private static int Raw(IFileProvider provider)
    {
        var raw = provider.SaveAsset(_object);
        Directory.CreateDirectory(Path.Combine(_out, "_probe"));
        var name = Path.GetFileNameWithoutExtension(_object) + ".bin";
        var outFile = Path.Combine(_out, "_probe", name);
        File.WriteAllBytes(outFile, raw);
        Console.WriteLine($"[ok] {raw.Length} bytes -> {outFile}");
        return 0;
    }

    private static int Scan(IFileProvider provider)
    {
        var pkg = provider.LoadPackage(_object);
        if (pkg is not CUE4Parse.UE4.Assets.IoPackage io)
        {
            Console.Error.WriteLine("[x] not IoPackage");
            return 4;
        }

        var raw = provider.SaveAsset(_object);
        var headerSize = (int) BitConverter.ToUInt32(raw, 4);
        var export = io.ExportMap[0];
        long exportSize = (long) export.CookedSerialSize;
        var names = io.NameMap;
        Console.WriteLine($"[i] len={raw.Length} headerSize={headerSize} exportSize={exportSize} names={names.Length}");

        var start = headerSize;
        var end = (int) Math.Min(raw.Length - 16, headerSize + exportSize);
        var hits = 0;

        for (var off = start; off < end; off++)
        {
            var v = BitConverter.ToUInt32(raw, off);
            if ((v >> 30) != 0) continue;
            var idx = v & 0x3FFFFFFF;
            if (idx >= names.Length) continue;
            var nm = names[idx].Name;
            if (nm is null || !nm.StartsWith("PF_")) continue;

            var skipOff = BitConverter.ToInt64(raw, off + 8);
            var p = off + 16;
            var flag = raw[p];
            var sx = BitConverter.ToInt32(raw, p + 16);
            var sy = BitConverter.ToInt32(raw, p + 20);
            var packed = BitConverter.ToUInt32(raw, p + 24);
            var strLen = BitConverter.ToInt32(raw, p + 28);

            Console.WriteLine($"hit @{off}: name={nm} skipOffset={skipOff} sizeOff={skipOff + off + 8} derivedFlag={flag} {sx}x{sy} packed=0x{packed:X8} nextStrLen={strLen}");
            hits++;
            off += 15;
        }

        Console.WriteLine($"[i] {hits} hits");
        return 0;
    }

    private static int SavePkg(IFileProvider provider)
    {
        var parts = provider.SavePackage(_object);
        foreach (var kv in parts)
        {
            Console.WriteLine($"  {kv.Key}: {kv.Value.Length} bytes");
        }

        Directory.CreateDirectory(Path.Combine(_out, "_probe"));
        foreach (var kv in parts)
        {
            File.WriteAllBytes(Path.Combine(_out, "_probe", kv.Key), kv.Value);
        }

        Console.WriteLine($"[ok] wrote {parts.Count} parts");
        return 0;
    }

    private static int Meta(IFileProvider provider)
    {
        var pkg = provider.LoadPackage(_object);
        if (pkg is not CUE4Parse.UE4.Assets.IoPackage io)
        {
            Console.Error.WriteLine($"[x] not an IoPackage: {pkg.GetType().Name}");
            return 4;
        }

        var raw = provider.SaveAsset(_object);
        Console.WriteLine($"[i] asset bytes: {raw.Length}");
        Console.WriteLine($"[i] exports: {io.ExportMap.Length}  versionUE={io.Summary.FileVersionUE}");

        for (var i = 0; i < Math.Min(io.ExportMap.Length, 4); i++)
        {
            var e = io.ExportMap[i];
            var name = io.CreateFNameFromMappedName(e.ObjectName);
            Console.WriteLine($"[{i}] {name.Text}  offset={e.CookedSerialOffset} size={e.CookedSerialSize}");

            var off = (int) e.CookedSerialOffset;
            var len = (int) Math.Min(e.CookedSerialSize, 96);
            if (off + len > raw.Length)
            {
                Console.WriteLine("     (offset beyond asset bytes)");
                continue;
            }

            var hex = string.Join(' ', raw[off..(off + len)].Select(b => b.ToString("X2")));
            Console.WriteLine("     " + hex);
            var txt = new string(raw.Skip(off).Take(len).Select(b => b >= 32 && b < 127 ? (char) b : '.').ToArray());
            Console.WriteLine("     " + txt);
        }

        return 0;
    }

    private static int Probe2(IFileProvider provider)
    {
        var options = new ExportOptions();
        var pkg = provider.LoadPackage(_object);
        ClearUnversionedFlag(pkg);

        var obj = pkg.ExportsLazy[0].Value;
        Console.WriteLine($"[i] export0: {obj?.GetType().Name} ({obj?.ExportType}) props={obj?.Properties.Count}");
        foreach (var p in obj?.Properties ?? [])
        {
            Console.WriteLine($"      {p.Name.Text} : {p.PropertyType.Text} size={p.Size}");
        }

        if (obj is not UTexture2D tex)
        {
            Console.Error.WriteLine("[x] not a texture");
            return 4;
        }

        var decoded = tex.DecodeMip(0, ETexturePlatform.DesktopMobile);
        if (decoded is null)
        {
            Console.Error.WriteLine($"[x] decode null (format={tex.Format})");
            return 5;
        }

        var bytes = decoded.Encode(options, out var ext);
        Directory.CreateDirectory(Path.Combine(_out, "_probe"));
        var file = Path.Combine(_out, "_probe", Path.GetFileName(_object) + "." + ext);
        File.WriteAllBytes(file, bytes);
        Console.WriteLine($"[ok] {decoded.Width}x{decoded.Height} {decoded.PixelFormat} -> {file} ({bytes.Length / 1024} KB)");
        return 0;
    }

    private static int Probe(IFileProvider provider)
    {
        var options = new ExportOptions();
        var obj = provider.LoadPackageObject(_object);
        if (obj is not UTexture2D tex)
        {
            Console.Error.WriteLine($"[x] not a texture: {obj?.GetType().Name ?? "null"}");
            return 4;
        }

        Console.WriteLine($"[i] {tex.Name}: PlatformData={(tex.PlatformData is null ? "null" : "ok")} format={tex.Format} props={tex.Properties.Count}");
        var decoded = tex.DecodeMip(0, ETexturePlatform.DesktopMobile);
        if (decoded is null)
        {
            Console.Error.WriteLine("[x] decode null");
            return 5;
        }

        var bytes = decoded.Encode(options, out var ext);
        Directory.CreateDirectory(Path.Combine(_out, "_probe"));
        var file = Path.Combine(_out, "_probe", Path.GetFileName(_object) + "." + ext);
        File.WriteAllBytes(file, bytes);
        Console.WriteLine($"[ok] {decoded.Width}x{decoded.Height} {decoded.PixelFormat} -> {file} ({bytes.Length / 1024} KB)");
        return 0;
    }

    private static int Tex(IFileProvider provider)
    {
        var all = provider.Files.Keys
            .Where(k => k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .Where(k => string.IsNullOrEmpty(_filter) || k.Contains(_filter, StringComparison.OrdinalIgnoreCase))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();

        Console.WriteLine($"[i] {all.Count} packages");
        var ok = 0;
        var fail = 0;

        foreach (var path in all.Take(_limit))
        {
            TexInfo info;
            try
            {
                info = Analyze(provider, path);
            }
            catch (Exception e)
            {
                Console.WriteLine($"[x] {path}: {e.GetType().Name}: {e.Message}");
                fail++;
                continue;
            }

            if (info is null)
            {
                Console.WriteLine($"[x] cannot analyse: {path}");
                fail++;
                continue;
            }

            var mip0 = (int) MipBytes(info.Width, info.Height, info.Format);
            if (mip0 <= 0 || info.PayloadOffset + mip0 > info.Raw.Length)
            {
                Console.WriteLine($"[x] size mismatch {info.Width}x{info.Height} {info.Format}: {path}");
                fail++;
                continue;
            }

            var src = new byte[mip0];
            Array.Copy(info.Raw, info.PayloadOffset, src, 0, mip0);
            var rgba = DecodeFormat(src, info.Width, info.Height, info.Format);
            if (rgba is null)
            {
                Console.WriteLine($"[x] unsupported {info.Format}: {path}");
                fail++;
                continue;
            }

            var name = Path.GetFileNameWithoutExtension(path);
            var outFile = Path.Combine(_out, name + ".png");
            WritePng(rgba, info.Width, info.Height, outFile);
            Console.WriteLine($"[ok] {name} {info.Width}x{info.Height} {info.Format}");
            ok++;
        }

        Console.WriteLine($"[i] done ok={ok} fail={fail}");
        return 0;
    }

    private static int Export(IFileProvider provider)
    {
        var packages = CardPackages(provider)
            .Where(k => k.EndsWith("_PrimaryAsset.uasset", StringComparison.OrdinalIgnoreCase))
            .Select(k => k[..^".uasset".Length])
            .ToList();

        Console.WriteLine($"[i] {packages.Count} cards to process");
        var options = new ExportOptions();
        var ok = 0;
        var fail = 0;

        foreach (var pkg in packages.Take(_limit))
        {
            try
            {
                var obj = provider.LoadPackageObject(pkg);
                if (obj is null) { fail++; Console.WriteLine($"[x] null {pkg}"); continue; }

                var tex = FindPrimaryTexture(obj);
                if (tex is null) { fail++; Console.WriteLine($"[x] no texture {pkg}"); continue; }

                var name = Path.GetFileName(pkg);
                var decoded = tex.DecodeMip(0, ETexturePlatform.DesktopMobile);
                if (decoded is null) { fail++; Console.WriteLine($"[x] decode null {pkg}"); continue; }

                var bytes = decoded.Encode(options, out var ext);
                var dir = Path.Combine(_out, "_probe");
                Directory.CreateDirectory(dir);
                var file = Path.Combine(dir, name + "." + ext);
                File.WriteAllBytes(file, bytes);
                Console.WriteLine($"[ok] {name} {decoded.Width}x{decoded.Height} {tex.Format} -> {bytes.Length / 1024}KB");
                ok++;
            }
            catch (Exception e)
            {
                fail++;
                Console.WriteLine($"[x] {pkg}: {e.GetType().Name}: {e.Message}");
            }
        }

        Console.WriteLine($"[i] done ok={ok} fail={fail}");
        return 0;
    }

    private static UTexture FindPrimaryTexture(UObject obj)
    {
        UTexture fallback = null;
        foreach (var prop in obj.Properties)
        {
            object val;
            try { val = obj.GetOrDefault<object>(prop.Name.Text); }
            catch { continue; }

            if (val is not UTexture t) continue;
            var n = prop.Name.Text;
            if (n.Contains("Large", StringComparison.OrdinalIgnoreCase)) return t;
            fallback ??= t;
        }

        return fallback;
    }
}
