-keepattributes *Annotation*
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes Signature
-keepattributes SourceFile,LineNumberTable

-keep class com.huawei.hianalytics.**{*;}
-keep class com.huawei.updatesdk.**{*;}
-keep class com.huawei.hms.**{*;}

-dontwarn com.huawei.android.os.**
-dontwarn com.huawei.android.telephony.**
-dontwarn com.huawei.libcore.io.**
-dontwarn org.bouncycastle.**
