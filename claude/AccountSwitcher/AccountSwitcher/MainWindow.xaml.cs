using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using AccountSwitcher.Models;
using AccountSwitcher.Services;

namespace AccountSwitcher;

public partial class MainWindow : Window
{
    private readonly AccountStore _store = new();
    private readonly RiotClientService _riot = new();
    private readonly ObservableCollection<Account> _accounts = new();

    public MainWindow()
    {
        InitializeComponent();
        AccountsList.ItemsSource = _accounts;

        foreach (var acc in _store.Load())
            _accounts.Add(acc);
    }

    private void AddButton_Click(object sender, RoutedEventArgs e)
    {
        var name = DisplayNameBox.Text.Trim();
        var ssid = SsidBox.Text.Trim();

        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(ssid))
        {
            StatusText.Text = "Enter both a name and the ssid value before adding.";
            return;
        }

        var account = new Account { DisplayName = name, Ssid = ssid };
        _accounts.Add(account);
        Persist();

        DisplayNameBox.Clear();
        SsidBox.Clear();
        StatusText.Text = $"Added \"{name}\".";
    }

    private void RemoveButton_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not Account account)
            return;

        if (MessageBox.Show($"Remove \"{account.DisplayName}\"?", "Confirm",
                MessageBoxButton.YesNo) != MessageBoxResult.Yes)
            return;

        _accounts.Remove(account);
        Persist();
        StatusText.Text = $"Removed \"{account.DisplayName}\".";
    }

    private void SwitchButton_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not Account account)
            return;

        if (!_riot.PrivateSettingsFileFound)
        {
            StatusText.Text = "Couldn't find the Riot Client settings file. " +
                               "Make sure Riot Client has been run at least once, and see the " +
                               "comment in RiotClientService.cs if the key name has changed.";
            return;
        }

        StatusText.Text = $"Switching to \"{account.DisplayName}\"...";

        var ok = _riot.SwitchTo(account.Ssid);
        if (!ok)
        {
            StatusText.Text = "Couldn't update the session file. See RiotClientService.cs " +
                               "for how to adjust the key pattern to match your client version.";
            return;
        }

        account.LastUsedAt = DateTime.UtcNow;
        Persist();
        StatusText.Text = $"Switched to \"{account.DisplayName}\" and relaunched.";
    }

    private void Persist() => _store.Save(_accounts.ToList());
}
