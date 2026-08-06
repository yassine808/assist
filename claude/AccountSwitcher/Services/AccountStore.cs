using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AccountSwitcher.Models;

namespace AccountSwitcher.Services;

/// <summary>
/// Loads/saves the account list to disk, encrypted at rest with Windows
/// DPAPI (CurrentUser scope) so the file is unreadable outside this
/// Windows account. This is local storage only — nothing is sent anywhere.
/// </summary>
public class AccountStore
{
    private readonly string _filePath;

    public AccountStore()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AccountSwitcher");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "accounts.dat");
    }

    public List<Account> Load()
    {
        if (!File.Exists(_filePath))
            return new List<Account>();

        try
        {
            var encrypted = File.ReadAllBytes(_filePath);
            var decrypted = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
            var json = Encoding.UTF8.GetString(decrypted);
            return JsonSerializer.Deserialize<List<Account>>(json) ?? new List<Account>();
        }
        catch
        {
            // Corrupt or unreadable (e.g. moved to another machine/user) - start fresh
            // rather than crashing the app.
            return new List<Account>();
        }
    }

    public void Save(List<Account> accounts)
    {
        var json = JsonSerializer.Serialize(accounts);
        var plain = Encoding.UTF8.GetBytes(json);
        var encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(_filePath, encrypted);
    }
}
