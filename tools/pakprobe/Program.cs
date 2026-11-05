using System.Text;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;

namespace pakprobe;

/// <summary>
/// Minimal VALORANT pak reader: list packages, dump a texture to PNG, read the
/// scalar-parameter block of a material instance.
/// </summary>
internal static class Program
{
    private static string _paks = @"C:\Riot Games\VALORANT\live\ShooterGame\Content\Paks";
    private static string _mode = "list";
    private static string _a = "";
    private static string _b = "";
    private static int _limit = 200;

    private sealed class EmptyMappings : ITypeMappingsProvider
    {
        public TypeMappings MappingsForGame { get; } = new();
        public void Load(string path, StringComparer comparer = null) { }
        public void Load(byte[] bytes, StringComparer comparer = null) { }
        public void Reload() { }
    }

    private static int Main(string[] args)
    {
        for (var i = 0; i < args.Length; i++)
        {
            if (i == 0) continue;
            string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{args[i]} needs a value");
            switch (args[i])
            {
                case "--paks": _paks = Next(); break;
                case "--limit": _limit = int.Parse(Next()); break;
                case "-h": case "--help":
                    Console.WriteLine("pakprobe <list|tex|params|obj> <arg> [out]  [--paks dir] [--limit n]");
                    return 0;
                default:
                    if (_a.Length == 0) _a = args[i];
                    else if (_b.Length == 0) _b = args[i];
                    else { Console.Error.WriteLine($"unexpected arg {args[i]}"); return 2; }
                    break;
            }
        }

        if (args.Length > 0) _mode = args[0];

        if (_mode == "api") return Api();
        if (_mode == "api2") return Api2();
        if (_mode == "apishader") return ApiShader();

        var provider = new DefaultFileProvider(
            new DirectoryInfo(_paks),
            SearchOption.TopDirectoryOnly,
            new VersionContainer(EGame.GAME_Valorant),
            StringComparer.OrdinalIgnoreCase);

        try
        {
            provider.Initialize();
            provider.SubmitKey(new FGuid(), new FAesKey(new string('0', 64)));
            provider.MappingsContainer = new EmptyMappings();
            Console.WriteLine($"[i] mounted, {provider.Files.Count} files");
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"[x] mount failed: {e.GetType().Name}: {e.Message}");
            return 3;
        }

        return _mode switch
        {
            "list" => List(provider),
            "raw" => Raw(provider),
            "tex" => Tex(provider),
            "params" => Params(provider),
            "obj" => Obj(provider),
            _ => 2,
        };
    }

    private static int Api()
    {
        var asm = typeof(CTexture).Assembly;
        foreach (var t in asm.GetTypes().Where(t => t.Name.Contains("Texture") || t.Name.Contains("Format")).OrderBy(t => t.FullName))
        {
            Console.WriteLine(t.FullName);
            foreach (var m in t.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.DeclaredOnly))
                Console.WriteLine("   " + m);
        }
        return 0;
    }

    private static int ApiShader()
    {
        foreach (var asm in AppDomain.CurrentDomain.GetAssemblies().Where(a => a.GetName().Name?.StartsWith("CUE4Parse") == true))
        {
            foreach (var t in asm.GetTypes().Where(t => t.Name.Contains("Shader") || t.FullName.Contains("Shader")))
            {
                Console.WriteLine(t.FullName);
                foreach (var m in t.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.DeclaredOnly))
                    Console.WriteLine("   " + m);
                foreach (var p in t.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.DeclaredOnly))
                    Console.WriteLine("   prop " + p.PropertyType.Name + " " + p.Name);
            }
        }
        return 0;
    }

    private static int Api2()
    {
        foreach (var asm in new[] { typeof(CTexture).Assembly, typeof(UTexture2D).Assembly })
        {
            foreach (var t in asm.GetTypes())
            {
                foreach (var m in t.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.DeclaredOnly))
                {
                    if (m.Name is "Encode" or "ToPng" or "Decode")
                        Console.WriteLine($"{t.FullName}: {m}");
                }
            }
        }
        return 0;
    }

    private static int Raw(IFileProvider provider)
    {
        var data = provider.SaveAsset(_a);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_b))!);
        File.WriteAllBytes(_b, data);
        Console.WriteLine($"[ok] {data.Length} B -> {_b}");
        return 0;
    }

    private static int List(IFileProvider provider)
    {
        var hits = provider.Files.Keys
            .Where(k => k.Contains(_a, StringComparison.OrdinalIgnoreCase))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();
        foreach (var h in hits.Take(_limit)) Console.WriteLine(h);
        Console.WriteLine($"[i] {hits.Count} hits");
        return 0;
    }

    /// <summary>
    /// The client cooks textures with unversioned properties, so the tagged PlatformData
    /// array cannot be parsed without a usmap. The cooked layout is still deterministic:
    /// FName "PF_*" + FString platform name, int64 payload size, then the mip header with
    /// SizeX/SizeY/format/Pitch/first-mip/mip-count, then the mip pixel chain. The chain is
    /// located from the export end, which is stable across formats.
    /// </summary>
    private static int Tex(IFileProvider provider)
    {
        if (provider.LoadPackage(_a) is not CUE4Parse.UE4.Assets.IoPackage io || io.ExportMap.Length == 0)
        {
            Console.Error.WriteLine("[x] not an IoPackage");
            return 4;
        }

        var raw = provider.SaveAsset(_a);
        var headerSize = (int) BitConverter.ToUInt32(raw, 4);
        long exportSize = (long) io.ExportMap[0].CookedSerialSize;
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
                if (raw[p] != 0) continue;
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

                var payloadEnd = (int) (dataEnd - 24);
                var hasTail = payloadEnd >= 0 && payloadEnd + 12 <= raw.Length
                              && BitConverter.ToInt32(raw, payloadEnd) == sx
                              && BitConverter.ToInt32(raw, payloadEnd + 4) == sy
                              && BitConverter.ToInt32(raw, payloadEnd + 8) == 1;
                if (!hasTail) payloadEnd = (int) dataEnd;

                var payloadOffset = payloadEnd - (int) chain;
                if (payloadOffset < p || payloadOffset + chain > raw.Length) continue;

                var mip0 = (int) MipBytes(sx, sy, nm);
                var src = new byte[mip0];
                Array.Copy(raw, payloadOffset, src, 0, mip0);
                var rgba = DecodeFormat(src, sx, sy, nm);
                if (rgba is null)
                {
                    Console.Error.WriteLine($"[x] unsupported format {nm}");
                    return 6;
                }

                var outPath = _b.Length > 0 ? _b : Path.GetFileNameWithoutExtension(_a) + ".rgba";
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
                File.WriteAllBytes(outPath, rgba);
                Console.WriteLine($"[ok] {sx}x{sy} {nm} mips={mipCount} -> {outPath} ({rgba.Length} B)");
                return 0;
            }
            catch (Exception e)
            {
                Console.Error.WriteLine($"[x] {e.GetType().Name}: {e.Message}");
            }
        }

        Console.Error.WriteLine("[x] no matching PF_ mip header found");
        return 5;
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

    private static byte[] DecodeFormat(byte[] src, int w, int h, string fmt) => fmt switch
    {
        "PF_BC1" or "PF_DXT1" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC1(src, w, h, 1),
        "PF_BC2" or "PF_DXT3" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC2(src, w, h, 1),
        "PF_BC3" or "PF_DXT5" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC3(src, w, h, 1),
        "PF_BC4" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC4(src, w, h, 1),
        "PF_BC5" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC5(src, w, h, 1),
        "PF_BC7" => CUE4Parse_Conversion.Textures.BC.BCDecoder.BC7(src, w, h, 1),
        "PF_B8G8R8A8" => BgraToRgba(src),
        "PF_R8G8B8A8" or "PF_A8R8G8B8" => src,
        _ => null
    };

    private static byte[] BgraToRgba(byte[] src)
    {
        var dst = new byte[src.Length];
        for (var i = 0; i + 3 < src.Length; i += 4)
        {
            dst[i] = src[i + 2];
            dst[i + 1] = src[i + 1];
            dst[i + 2] = src[i];
            dst[i + 3] = src[i + 3];
        }
        return dst;
    }

    /// <summary>
    /// Material instances cook with unversioned properties, so the tags are unreadable.
    /// The FScalarParameterValue array is still serialized inline: FName (8) + association
    /// byte (2 = global) + int32 index (-1) + float value, stride 37 bytes. Read the
    /// longest contiguous run so accidental byte matches are excluded.
    /// </summary>
    private static int Params(IFileProvider provider)
    {
        var files = provider.Files.Keys
            .Where(k => k.Contains(_a, StringComparison.OrdinalIgnoreCase) && k.EndsWith("_MI.uasset", StringComparison.OrdinalIgnoreCase))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (files.Count == 0)
        {
            Console.Error.WriteLine("[x] no matching _MI.uasset");
            return 4;
        }

        if (_b == "csv") Console.WriteLine("card,posH,posV,ratio,scale,cols,rows");
        foreach (var f in files)
        {
            DumpParams(provider, f);
            if (_b != "csv") Console.WriteLine();
        }

        return 0;
    }

    private static void DumpParams(IFileProvider provider, string file)
    {
        if (provider.LoadPackage(file) is not CUE4Parse.UE4.Assets.IoPackage io)
        {
            Console.Error.WriteLine("[x] not an IoPackage");
            return;
        }

        var raw = provider.SaveAsset(file);
        var names = io.NameMap;
        var starts = new List<long>();

        for (var off = 0; off + 17 <= raw.Length; off++)
        {
            if (raw[off + 8] != 2) continue;
            if (BitConverter.ToInt32(raw, off + 9) != -1) continue;
            var idx = BitConverter.ToUInt32(raw, off);
            if (BitConverter.ToUInt32(raw, off + 4) != 0) continue;
            if (idx >= names.Length) continue;
            starts.Add(off);
        }

        var runs = new List<List<long>>();
        var cur = new List<long>();
        foreach (var s in starts)
        {
            if (cur.Count == 0 || s - cur[^1] == 37) cur.Add(s);
            else { runs.Add(cur); cur = new List<long> { s }; }
        }
        if (cur.Count > 0) runs.Add(cur);

        var map = new Dictionary<string, float>();
        foreach (var run in runs.Where(r => r.Count >= 3))
            foreach (var off in run)
            {
                var n = names[BitConverter.ToUInt32(raw, (int) off)].Name;
                if (!map.ContainsKey(n)) map[n] = BitConverter.ToSingle(raw, (int) off + 13);
            }

        if (_b == "csv")
        {
            float Get(string n) => map.TryGetValue(n, out var v) ? v : float.NaN;
            Console.WriteLine(string.Join(",",
                (file.Split('/')[^3] == "Materials" ? file.Split('/')[^2] : file.Split('/')[^3]),
                Get("Flipbook UV Position Horizontal").ToString("0.######"),
                Get("Flipbook UV Position Vertical").ToString("0.######"),
                Get("Flipbook UV Ratio").ToString("0.######"),
                Get("Flipbook UV Scale").ToString("0.######"),
                Get("Flipbook Columns").ToString("0"),
                Get("Flipbook Rows").ToString("0"),
                Get("Flipbook Speed").ToString("0.######"),
                Get("Procedural Animations Addive Blending").ToString("0.######")));
            return;
        }

        Console.WriteLine($"[i] {file}");
        foreach (var run in runs.Where(r => r.Count >= 3))
        {
            Console.WriteLine($"[i] run at {run[0]} ({run.Count} params)");
            foreach (var off in run)
            {
                var idx = BitConverter.ToUInt32(raw, (int) off);
                var name = names[idx].Name;
                var val = BitConverter.ToSingle(raw, (int) off + 13);
                Console.WriteLine($"   {name,-45} {val.ToString("0.######")}");
            }
        }
    }

    private static int Obj(IFileProvider provider)
    {
        var pkg = provider.LoadPackage(_a);
        foreach (var e in pkg.GetExports())
        {
            Console.WriteLine($"[{e.Name}] {e.GetType().Name}");
            try
            {
                var sb = new StringBuilder();
                foreach (var p in e.Properties)
                    sb.AppendLine($"   {p.Name} = {p.Tag?.GenericValue}");
                Console.Write(sb.ToString());
            }
            catch (Exception ex)
            {
                Console.WriteLine($"   [x] props: {ex.GetType().Name}: {ex.Message}");
            }
        }

        return 0;
    }
}


