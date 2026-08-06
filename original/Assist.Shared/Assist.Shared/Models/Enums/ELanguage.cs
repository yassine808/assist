using System;

namespace Assist.Models.Enums;

public enum ELanguage
{
    [Language("en-US")] 
    English = 0,

    [Language("es-ES")] 
    Spanish = 1,

    [Language("fr")] 
    French = 2,
    
    [Language("pt-BR")] 
    Portuguese = 3,

    [Language("ja")]
    Japanese = 4,
}

[AttributeUsage(AttributeTargets.Field)]
public class LanguageAttribute : Attribute
{
    public string Code { get; set; }

    public LanguageAttribute(string code)
    {
        Code = code;
    }
}