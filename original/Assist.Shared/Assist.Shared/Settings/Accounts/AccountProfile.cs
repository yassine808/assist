using System;
using System.Collections.Generic;
using System.Net;
using System.Text;
using Assist.Shared.Services.Utils;
using Serilog;
using ValNet.Enums;

namespace Assist.Shared.Settings.Accounts;

public class AccountProfile
{
    public string Id { get; set; }
    public AccountProfilePersonalization Personalization { get; set; } = new AccountProfilePersonalization();
    
    /// <summary>
    /// Stores path for the riot launcher information.
    /// </summary>
    public string BackupZipPath { get; set; }
    
    /// <summary>
    /// Stores path for the riot launcher information.
    /// </summary>
    public bool UsesBackupZip { get; set; }= false;

    /// <summary>
    /// Stores path for the riot launcher information.
    /// </summary>
    public bool UsesLauncherCode { get; set; } = false;
    
    /// <summary>
    /// Stores the Riot Account Token to Relogin.
    /// </summary>
    public string AssistCAuthCode { get; set; }
    
    /// <summary>
    /// Stores the Riot Account Token to Relogin.
    /// </summary>
    public string AssistLauncherCode { get; set; }

    /// <summary>
    /// Signifies if Assist can Attempt to Login to the account.
    /// </summary>
    public bool CanAssistBoot { get; set; } = false;
    
    /// <summary>
    /// Signifies if Account can be used to login to the Riot Client.
    /// </summary>
    public bool CanLauncherBoot { get; set; } = false;
    
    /// <summary>
    /// Signifies if Account is dead. lol
    /// </summary>
    public bool IsExpired { get; set; } = false;
    
    public DateTime LastLoginTime { get; set; }
    
    public RiotRegion Region { get; set; }
    
    /// <summary>
    /// Username to Login to Riot Account Automatically (Testing)
    /// </summary>
    public string Username { get; set; }
    
    /// <summary>
    /// Password to Login to Riot Account Automatically (Testing)
    /// </summary>
    public string Password { get; set; }
    
    public class AccountProfilePersonalization
    {
        public string AccountNickName { get; set; }
        public string GameName { get; set; }
        public string TagLine { get; set; }
        public string RiotId => $"{GameName}#{TagLine}";
        public int PlayerLevel { get; set; }
        public int ValRankTier { get; set; } = 0;
        public string PlayerCardId { get; set; }
        public string ProfileNote { get; set; }
    }
    
    public class AccountProfileShortcutSettings
    {
        /// <summary>
        /// When using a shortcut to quickboot, assist will autolaunch into GameMode.
        /// </summary>
        public bool LaunchGameMode { get; set; } = false;
    }

    public string GetAccountCAuthCode()
    {
        
        if (string.IsNullOrEmpty(AssistCAuthCode))
        {
            Log.Information("Attempted to get AssistCAuthCode for Assist Account Profile when there is not one.");
            return null;
        }

        return MotionCat.Decrypt(AssistCAuthCode, MotionCat.GetHardwareId());
    }
    
    public void SaveAccountCAuthCode(string code)
    {
        AssistCAuthCode = MotionCat.Encrypt(code, MotionCat.GetHardwareId());
        AccountSettings.Save();
    }
    
    public void SaveAccountLauncherCode(string code)
    {
        AssistLauncherCode = MotionCat.Encrypt(code, MotionCat.GetHardwareId());
        AccountSettings.Save();
    }
    
    public string GetAccountLauncherCode()
    {
        
        if (string.IsNullOrEmpty(AssistLauncherCode))
        {
            Log.Information("Attempted to get AssistLauncherCode for Assist Account Profile when there is not one.");
            return null;
        }

        return MotionCat.Decrypt(AssistLauncherCode, MotionCat.GetHardwareId());
    }
    
    
     public Dictionary<string, Cookie> Convert64ToCookies()
        {
            Dictionary<string, Cookie> cookiecontainer = new Dictionary<string, Cookie>();
            
            foreach (string cookie in AssistCAuthCode.Split("||assist||"))
            {
                var regCookie = Encoding.UTF8.GetString(Convert.FromBase64String(cookie));
                if (string.IsNullOrEmpty(regCookie))
                {
                    continue;
                }
                var newCookieObj = CreateCookieFromString(regCookie);
                if (newCookieObj.Name == "did")
                {
                    continue;
                }
                
                cookiecontainer.Add(newCookieObj.Name, newCookieObj);
            }

            return cookiecontainer;

        }

        public void ConvertCookiesTo64(Dictionary<string, Cookie> container)
        {
            string sixFour = "";

            foreach (var cookie in container)
            {
                string s = $"{cookie.Value}";
                var plainTextBytes = Encoding.UTF8.GetBytes(s);
                sixFour += Convert.ToString(plainTextBytes) + "||assist||";
            }

            this.AssistCAuthCode = sixFour;
        }

        public void ConvertCookiesTo64(IEnumerable<Cookie> container)
        {
            string sixFour = "";

            foreach (var cookie in container)
            {
                string s = $"{cookie}";
                var plainTextBytes = Encoding.UTF8.GetBytes(s);
                sixFour += Convert.ToBase64String(plainTextBytes) + "||assist||";
            }

            this.AssistCAuthCode = sixFour;
        }

    
        
        public static Cookie CreateCookieFromString(string cookieString)
        {
            // Create a new cookie object
            Cookie cookie = new Cookie();

            // Split the cookie string into individual parts
            string[] cookieParts = cookieString.Split(';');

            // Loop through the parts and set the corresponding cookie properties
            foreach (string part in cookieParts)
            {
                string[] nameValue = part.Trim().Split('=');
                string name = nameValue[0].Trim();
                string value = nameValue.Length > 1 ? nameValue[1].Trim() : string.Empty;

                switch (name.ToLower())
                {
                    case "path":
                        cookie.Path = value;
                        break;
                    case "domain":
                        cookie.Domain = value;
                        break;
                    case "expires":
                        if (DateTime.TryParse(value, out DateTime expires))
                        {
                            cookie.Expires = expires;
                        }
                        break;
                    case "secure":
                        cookie.Secure = true;
                        break;
                    case "httponly":
                        cookie.HttpOnly = true;
                        break;
                    default:
                        cookie.Name = name;
                        cookie.Value = value;
                        break;
                }
            }

            return cookie;
        }
}

